const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const multer = require('multer');
const MedicineDB = require('./medicineDb');

const app = express();
const port = 3000;

const medicineDB = new MedicineDB();

medicineDB.initialize()
  .then(() => medicineDB.importFromCSV())
  .catch(err => console.error('DB initialization error:', err));

// const corsOptions = {
//   origin: 'http://127.0.0.1:5501', // Or whatever Live Server shows
//   methods: ['GET', 'POST'],
//   allowedHeaders: ['Content-Type']
// };
// app.use(cors({
//   origin: 'http://127.0.0.1:5501',
//   methods: ['GET', 'POST'],
//   credentials: true
// }));
app.use(cors()); // allows all origins

//app.use(cors(corsOptions)); // Allow requests from your frontend
// Add this in your server.js file, after your `app.use(cors())` line
app.get('/', (req, res) => {
  res.send('✅ WhatsApp ERP Backend is running!');
});

app.use(express.json());  // Parse JSON data from requests

const fs = require('fs');
const path = require('path');
const RETAILERS_JSON_PATH = path.join(__dirname, 'retailers.json');
const CUSTOMERS_JSON_PATH = path.join(__dirname, 'customers.json');

// Setup multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Endpoint to upload custom medicine CSV for retailer
app.post('/upload-medicine-csv', upload.single('file'), async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing retailer email' });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerCsvPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.csv`);
  const retailerDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);

  try {
    // Move uploaded file to retailer CSV path (overwrite if exists)
    fs.renameSync(req.file.path, retailerCsvPath);

    // Delete existing DB file if exists to ensure fresh initialization
    if (fs.existsSync(retailerDbPath)) {
      fs.unlinkSync(retailerDbPath);
    }

    // Initialize MedicineDB for retailer and import CSV
    const retailerMedicineDB = new MedicineDB(retailerDbPath, retailerCsvPath);
    await retailerMedicineDB.initialize();
    await retailerMedicineDB.importFromCSV();
    retailerMedicineDB.close();

    res.json({ success: true, message: 'Medicine CSV uploaded and database updated successfully' });
  } catch (err) {
    console.error('Error processing uploaded medicine CSV:', err);
    res.status(500).json({ success: false, message: 'Failed to process uploaded CSV', error: err.message });
  }
});

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true,  // Keep it headless once linked
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp Bot is ready!');
});

client.initialize();

// API Endpoint to send a message and update purchase history
app.post('/send-message', async (req, res) => {
  const { phone, message, retailerEmail, customerName, medicineName, expiryDate } = req.body;

  console.log('Received /send-message request with data:', { phone, message, retailerEmail, customerName, medicineName, expiryDate });

  if (!phone || !message) {
    console.log('Missing phone or message in request');
    return res.status(400).json({ success: false, message: 'Missing phone or message' });
  }

  if (!client.info || !client.info.wid) {
    console.log('WhatsApp client not ready');
    return res.status(503).json({ success: false, message: 'WhatsApp client not ready' });
  }

  try {
    console.log(`Sending message to ${phone}@c.us`);
    const response = await client.sendMessage(`${phone}@c.us`, message);
    console.log('Message sent successfully via WhatsApp API');

    if (retailerEmail && customerName && medicineName && expiryDate) {
      console.log('All required data present for purchase history update');

      const safeEmail = retailerEmail.replace(/[^a-zA-Z0-9]/g, '_');
      const retailerCustomerCsvPath = path.join(__dirname, 'retailers', `customers_${safeEmail}.csv`);

      const csvLine = `"${customerName}","","${phone}","${medicineName}","1","${expiryDate}","${message.replace(/"/g, '""')}"\n`;

      // Check if file exists, if not write headers
      if (!fs.existsSync(retailerCustomerCsvPath)) {
        console.log('Customer CSV file does not exist, creating with headers');
        const headers = '"Customer Name","Location","Phone","Medicine Name","Quantity","Expiry Date","Message"\n';
        fs.writeFileSync(retailerCustomerCsvPath, headers);
      }

      try {
        fs.appendFileSync(retailerCustomerCsvPath, csvLine);
        console.log(`Purchase history updated for customer ${customerName} in ${retailerCustomerCsvPath}`);
      } catch (err) {
        console.error('Error writing customer data to CSV:', err);
      }
    } else {
      console.log('Insufficient data to update purchase history');
    }

    res.json({ success: true, message: 'Message sent successfully!' });
  } catch (err) {
    console.error('Failed to send message via WhatsApp API:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(500).json({ success: false, message: 'Failed to send message', error: err });
  }
});

app.post('/signup', async (req, res) => {
  const { userType, email, phone, shopKeeperName, shopName, password } = req.body;

  if (!userType || !email || !phone || !shopKeeperName || !password || (userType === 'retailer' && !shopName)) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const jsonPath = userType === 'retailer' ? RETAILERS_JSON_PATH : CUSTOMERS_JSON_PATH;

  // Read existing users
  fs.readFile(jsonPath, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File does not exist, create empty array
        data = '[]';
      } else {
        console.error(`Error reading ${jsonPath}:`, err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
    }

    let users = [];
    try {
      users = JSON.parse(data);
    } catch (parseErr) {
      console.error(`Error parsing ${jsonPath}:`, parseErr);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    // Check if email already exists
    if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Add new user
    const newUser = userType === 'retailer'
      ? { email, phone, shopKeeperName, shopName, password }
      : { email, phone, shopKeeperName, password };

    users.push(newUser);

    // Save back to file
    fs.writeFile(jsonPath, JSON.stringify(users, null, 2), (writeErr) => {
      if (writeErr) {
        console.error(`Error writing ${jsonPath}:`, writeErr);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }

      res.json({ success: true, message: 'Signup successful' });
    });
  });
});

app.post('/login', (req, res) => {
  const { userType, email, password } = req.body;
  if (!userType || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing userType, email or password' });
  }

  const jsonPath = userType === 'retailer' ? RETAILERS_JSON_PATH : CUSTOMERS_JSON_PATH;

  fs.readFile(jsonPath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading ${jsonPath}:`, err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    let users = [];
    try {
      users = JSON.parse(data);
    } catch (parseErr) {
      console.error(`Error parsing ${jsonPath}:`, parseErr);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Return user details along with success message
    const { password: _, ...userWithoutPassword } = user;
    res.json({ success: true, message: 'Login successful', user: userWithoutPassword });
  });
});

// API Endpoint to check medicine expiry and send reminders to customers with medicines expiring within 30 days
const csvParser = require('csv-parser');
const { parse } = require('date-fns');

app.post('/check-expiry', (req, res) => {
  const { email } = req.body;
  console.log('Received /check-expiry request for email:', email);
  if (!email) {
    console.log('Missing retailer email in request');
    return res.status(400).json({ success: false, message: 'Missing retailer email' });
  }

  if (!client.info || !client.info.wid) {
    console.log('WhatsApp client not ready');
    return res.status(503).json({ success: false, message: 'WhatsApp client not ready' });
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerCustomerCsvPath = path.join(__dirname, 'retailers', `customers_${safeEmail}.csv`);
  console.log('Looking for customer CSV at:', retailerCustomerCsvPath);

  if (!fs.existsSync(retailerCustomerCsvPath)) {
    console.log('Customer CSV not found for retailer:', safeEmail);
    return res.status(404).json({ success: false, message: 'No customer data found for this retailer' });
  }

  const customersToNotify = [];
  const today = new Date();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  fs.createReadStream(retailerCustomerCsvPath)
    .pipe(csvParser())
    .on('data', (row) => {
      try {
        const expiryDateStr = row['Expiry Date'];
        if (!expiryDateStr) return;

        // Parse expiry date, assuming format YYYY-MM-DD or similar
        const expiryDate = new Date(expiryDateStr);
        if (isNaN(expiryDate)) return;

        const diff = expiryDate.getTime() - today.getTime();
        if (diff >= 0 && diff <= THIRTY_DAYS) {
          customersToNotify.push(row);
          console.log(`Customer to notify: ${row['Customer Name']} with medicine ${row['Medicine Name']} expiring on ${expiryDateStr}`);
        }
      } catch (err) {
        console.error('Error processing row:', err);
      }
    })
    .on('end', async () => {
      console.log(`Total customers to notify: ${customersToNotify.length}`);
      if (customersToNotify.length === 0) {
        return res.json({ success: true, message: 'No customers with medicines expiring within 30 days' });
      }

      let sentCount = 0;
      let failedCount = 0;

      for (const customer of customersToNotify) {
        const phoneRaw = customer['Phone'];
        let phone = phoneRaw.replace(/\D/g, ''); // Remove non-digit characters
        const customerName = customer['Customer Name'];
        const medicineName = customer['Medicine Name'];
        const expiryDate = customer['Expiry Date'];

        if (!phone) {
          console.error(`Invalid phone number for customer ${customerName}: ${phoneRaw}`);
          failedCount++;
          continue;
        }

        // Prepend default country code if phone length is less than 10 digits (adjust as needed)
        if (phone.length < 10) {
          phone = '91' + phone; // Assuming India country code as default
          console.log(`Prepended country code to phone number: ${phone}`);
        }

        const message = `Dear ${customerName},\n\nThis is a reminder that your purchased medicine "${medicineName}" is expiring on ${expiryDate}. Please consider renewing your stock.\n\nThank you for choosing our service.`;

        try {
          console.log(`Sending message to ${phone}: ${message}`);
          await client.sendMessage(`${phone}@c.us`, message);
          sentCount++;
        } catch (err) {
          console.error(`Failed to send message to ${phone}:`, err);
          failedCount++;
        }
      }

      console.log(`Expiry reminders sent. Success: ${sentCount}, Failed: ${failedCount}`);
      res.json({ success: true, message: `Expiry reminders sent. Success: ${sentCount}, Failed: ${failedCount}` });
    })
    .on('error', (err) => {
      console.error('Error reading customer CSV:', err);
      res.status(500).json({ success: false, message: 'Failed to read customer data', error: err.message });
    });
});

// API Endpoint to get all medicines
// API Endpoint to get all medicines
app.get('/medicines', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing retailer email' });
  }
  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);
  const retailerCsvPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.csv`);

  // Ensure medicine CSV file exists, if not copy from original
  const originalCsvPath = path.join(__dirname, 'medicines.csv');
  if (!fs.existsSync(retailerCsvPath)) {
    try {
      fs.copyFileSync(originalCsvPath, retailerCsvPath);
    } catch (copyErr) {
      console.error('Error copying medicine CSV for retailer:', copyErr);
      return res.status(500).json({ success: false, message: 'Failed to prepare medicine CSV file', error: copyErr.message });
    }
  }

  const retailerMedicineDB = new MedicineDB(retailerDbPath, retailerCsvPath);
  try {
    // Check if DB file exists, if not initialize it
    if (!fs.existsSync(retailerDbPath)) {
      await retailerMedicineDB.initialize();
      await retailerMedicineDB.importFromCSV();
    }
    const medicines = await retailerMedicineDB.getAllMedicines();
    retailerMedicineDB.close();
    res.json({ success: true, data: medicines });
  } catch (err) {
    console.error('Error fetching medicines:', err.stack || err);
    res.status(500).json({ success: false, message: 'Failed to fetch medicines', error: err.message });
  }
});

// API Endpoint to refresh medicines database from CSV
app.post('/refresh-medicines', async (req, res) => {
  try {
    await medicineDB.importFromCSV();
    res.json({ success: true, message: 'Medicines database refreshed from CSV' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to refresh medicines database', error: err.message });
  }
});

app.post('/deduct-medicine', async (req, res) => {
  const { id, quantity, email } = req.body;
  if (!id || !quantity || quantity <= 0 || !email) {
    return res.status(400).json({ success: false, message: 'Invalid medicine id, quantity or missing retailer email' });
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);
  const retailerCsvPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.csv`);

  const retailerMedicineDB = new MedicineDB(retailerDbPath, retailerCsvPath);

  try {
    // Check if DB file exists, if not initialize it
    if (!fs.existsSync(retailerDbPath)) {
      await retailerMedicineDB.open();
      await retailerMedicineDB.initialize();
      await retailerMedicineDB.importFromCSV();
    } else {
      await retailerMedicineDB.open();
    }

    // Get current quantity
    const medicines = await retailerMedicineDB.getAllMedicines();
    const medicine = medicines.find(med => med.id === parseInt(id));
    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found' });
    }
    if (medicine.quantity < quantity) {
      return res.status(400).json({ success: false, message: 'Insufficient quantity in stock' });
    }

    // Update quantity in database
    const newQuantity = medicine.quantity - quantity;
    await new Promise((resolve, reject) => {
      retailerMedicineDB.db.run(
        'UPDATE medicines SET quantity = ? WHERE id = ?',
        [newQuantity, id],
        function(err) {
          if (err) {
            console.error('Error updating medicine quantity:', err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    retailerMedicineDB.close();

    res.json({ success: true, message: 'Quantity deducted successfully', newQuantity });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to deduct quantity', error: err.message });
  }
});

app.post('/save-customer-data', (req, res) => {
  const { customerName, location, phone, medicineName, quantity, expiryDate, message, email } = req.body;
  if (!customerName || !location || !phone || !medicineName || !quantity || !expiryDate || !email) {
    return res.status(400).json({ success: false, message: 'Missing required customer data or retailer email' });
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerCustomerCsvPath = path.join(__dirname, 'retailers', `customers_${safeEmail}.csv`);

  const csvLine = `"${customerName}","${location}","${phone}","${medicineName}","${quantity}","${expiryDate}","${message.replace(/"/g, '""')}"\n`;

  // Check if file exists, if not write headers
  if (!fs.existsSync(retailerCustomerCsvPath)) {
    const headers = '"Customer Name","Location","Phone","Medicine Name","Quantity","Expiry Date","Message"\n';
    fs.writeFileSync(retailerCustomerCsvPath, headers);
  }

  fs.appendFile(retailerCustomerCsvPath, csvLine, (err) => {
    if (err) {
      console.error('Error writing customer data to CSV:', err);
      return res.status(500).json({ success: false, message: 'Failed to save customer data' });
    }
    res.json({ success: true, message: 'Customer data saved successfully' });
  });
});

// Endpoint to reinitialize medicines DB for a retailer
app.post('/reinitialize-medicines-db', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing retailer email' });
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);
  const retailerCsvPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.csv`);

  try {
    // Delete existing DB file if exists
    if (fs.existsSync(retailerDbPath)) {
      fs.unlinkSync(retailerDbPath);
    }

    // Initialize MedicineDB for retailer and import CSV
    const retailerMedicineDB = new MedicineDB(retailerDbPath, retailerCsvPath);
    await retailerMedicineDB.initialize();
    await retailerMedicineDB.importFromCSV();
    retailerMedicineDB.close();

    res.json({ success: true, message: 'Medicines database reinitialized successfully' });
  } catch (err) {
    console.error('Error reinitializing medicines database:', err);
    res.status(500).json({ success: false, message: 'Failed to reinitialize medicines database', error: err.message });
  }
});

// New endpoint to get retailer details by email
app.get('/retailer-details', (req, res) => {
  let { email } = req.query;
  console.log('Received /retailer-details request for email:', email);
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing email parameter' });
  }
  email = email.trim().toLowerCase();

  fs.readFile(RETAILERS_JSON_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading retailers.json:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    let retailers = [];
    try {
      retailers = JSON.parse(data);
      console.log('Retailers loaded:', retailers.map(r => r.email));
    } catch (parseErr) {
      console.error('Error parsing retailers.json:', parseErr);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    const retailer = retailers.find(r => r.email.toLowerCase() === email);
    if (!retailer) {
      console.log('Retailer not found for email:', email);
      return res.status(404).json({ success: false, message: 'Retailer not found' });
    }

    console.log('Found retailer:', retailer);
    // Return retailer details except password
    const { password, ...retailerDetails } = retailer;
    res.json({ success: true, data: retailerDetails });
  });
});

app.get('/sales-data', async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing retailer email' });
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerCustomerCsvPath = path.join(__dirname, 'retailers', `customers_${safeEmail}.csv`);
  const retailerMedicineDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);

  if (!fs.existsSync(retailerCustomerCsvPath)) {
    return res.status(404).json({ success: false, message: 'No sales data found for this retailer' });
  }
  if (!fs.existsSync(retailerMedicineDbPath)) {
    return res.status(404).json({ success: false, message: 'No medicine database found for this retailer' });
  }

  const salesByMedicine = {};

  const stats = fs.statSync(retailerCustomerCsvPath);
  const modifiedDate = stats.mtime.toISOString().split('T')[0]; // YYYY-MM-DD

  fs.createReadStream(retailerCustomerCsvPath)
    .pipe(csvParser())
    .on('data', (row) => {
      const medicineName = row['Medicine Name'] || 'Unknown';
      const quantity = parseInt(row['Quantity'], 10) || 0;
      if (!salesByMedicine[medicineName]) {
        salesByMedicine[medicineName] = 0;
      }
      salesByMedicine[medicineName] += quantity;
    })
    .on('end', () => {
      // Open medicine DB and get prices for medicines
      const sqlite3 = require('sqlite3').verbose();
      const db = new sqlite3.Database(retailerMedicineDbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          console.error('Error opening medicine DB:', err);
          return res.status(500).json({ success: false, message: 'Failed to open medicine database', error: err.message });
        }
      });

      const medicineNames = Object.keys(salesByMedicine);
      if (medicineNames.length === 0) {
        db.close();
        return res.json({ success: true, data: [] });
      }

      const placeholders = medicineNames.map(() => '?').join(',');
      const query = `SELECT name, price FROM medicines WHERE name IN (${placeholders})`;

      db.all(query, medicineNames, (err, rows) => {
        if (err) {
          console.error('Error querying medicine prices:', err);
          db.close();
          return res.status(500).json({ success: false, message: 'Failed to query medicine prices', error: err.message });
        }

        const priceMap = {};
        rows.forEach(row => {
          priceMap[row.name] = row.price;
        });

        const salesArray = medicineNames.map(medName => {
          const totalQuantity = salesByMedicine[medName];
          const price = priceMap[medName] || 0;
          const totalPrice = price * totalQuantity;
          return { date: modifiedDate, medicineName: medName, totalQuantity, price, totalPrice };
        }).sort((a, b) => a.medicineName.localeCompare(b.medicineName));

        db.close();
        res.json({ success: true, data: salesArray });
      });
    })
    .on('error', (err) => {
      console.error('Error reading sales data CSV:', err);
      res.status(500).json({ success: false, message: 'Failed to read sales data', error: err.message });
    });
});

app.get('/customer-purchases', (req, res) => {
  const { email, phone } = req.query;
  if (!email && !phone) {
    return res.status(400).json({ success: false, message: 'Missing email or phone parameter' });
  }

  const customersDir = path.join(__dirname, 'retailers');
  const purchaseRecords = [];

  fs.readdir(customersDir, (err, files) => {
    if (err) {
      console.error('Error reading retailers directory:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    const customerFiles = files.filter(f => f.startsWith('customers_') && f.endsWith('.csv'));
    if (customerFiles.length === 0) {
      return res.json({ success: true, data: [] });
    }

    let filesProcessed = 0;

    customerFiles.forEach(file => {
      const filePath = path.join(customersDir, file);
      fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          const customerEmail = row['Email'] || '';
          const customerPhone = row['Phone'] || '';
          if ((email && customerEmail.toLowerCase() === email.toLowerCase()) ||
              (phone && customerPhone === phone)) {
            purchaseRecords.push(row);
          }
        })
        .on('end', () => {
          filesProcessed++;
          if (filesProcessed === customerFiles.length) {
            res.json({ success: true, data: purchaseRecords });
          }
        })
        .on('error', (error) => {
          console.error('Error reading customer purchase CSV:', error);
          res.status(500).json({ success: false, message: 'Failed to read purchase data', error: error.message });
        });
    });
  });
});

app.get('/test', (req, res) => {
  console.log('Received /test request');
  res.json({ success: true, message: 'Test endpoint reached' });
});

app.post('/reset-password', (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  if (!email || !currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing email, currentPassword or newPassword' });
  }

  // Read customers.json to find the user
  fs.readFile(CUSTOMERS_JSON_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading customers.json:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    let customers = [];
    try {
      customers = JSON.parse(data);
    } catch (parseErr) {
      console.error('Error parsing customers.json:', parseErr);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    const userIndex = customers.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (userIndex === -1) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = customers[userIndex];
    if (user.password !== currentPassword) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Update password
    customers[userIndex].password = newPassword;

    // Save updated customers.json
    fs.writeFile(CUSTOMERS_JSON_PATH, JSON.stringify(customers, null, 2), (writeErr) => {
      if (writeErr) {
        console.error('Error writing customers.json:', writeErr);
        return res.status(500).json({ success: false, message: 'Failed to update password' });
      }

      res.json({ success: true, message: 'Password reset successful' });
    });
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
