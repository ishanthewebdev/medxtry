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

// API Endpoint to send a message
app.post('/send-message', (req, res) => {
  const { phone, message } = req.body;

  client.sendMessage(`${phone}@c.us`, message)
    .then(response => {
      res.json({ success: true, message: 'Message sent successfully!' });
    })
    .catch(err => {
      res.status(500).json({ success: false, message: 'Failed to send message', error: err });
    });
});

// Signup endpoint
app.post('/signup', async (req, res) => {
  const { email, phone, shopKeeperName, shopName, password } = req.body;
  if (!email || !phone || !shopKeeperName || !shopName || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Read existing retailers
  fs.readFile(RETAILERS_JSON_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading retailers.json:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    let retailers = [];
    try {
      retailers = JSON.parse(data);
    } catch (parseErr) {
      console.error('Error parsing retailers.json:', parseErr);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    // Check if email already exists
    if (retailers.some(r => r.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Add new retailer
    retailers.push({ email, phone, shopKeeperName, shopName, password });

    // Save back to file
    fs.writeFile(RETAILERS_JSON_PATH, JSON.stringify(retailers, null, 2), (writeErr) => {
      if (writeErr) {
        console.error('Error writing retailers.json:', writeErr);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }

      // No longer create or initialize retailer-specific medicine CSV and DB files

      res.json({ success: true, message: 'Signup successful' });
    });
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Missing email or password' });
  }

  fs.readFile(RETAILERS_JSON_PATH, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading retailers.json:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    let retailers = [];
    try {
      retailers = JSON.parse(data);
    } catch (parseErr) {
      console.error('Error parsing retailers.json:', parseErr);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    const retailer = retailers.find(r => r.email.toLowerCase() === email.toLowerCase() && r.password === password);
    if (!retailer) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    res.json({ success: true, message: 'Login successful' });
  });
});

// API Endpoint to check medicine expiry (just a demo endpoint)
app.get('/check-expiry', (req, res) => {
  // Add your expiry logic here
  res.json({ success: true, message: 'Expiry check executed' });
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

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
