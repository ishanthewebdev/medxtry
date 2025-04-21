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
const db = require('./db');
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
  const { phone, message, retailerEmail, customerName, medicineName, expiryDate, quantity } = req.body;

  console.log('Received /send-message request with data:', { phone, message, retailerEmail, customerName, medicineName, expiryDate, quantity });

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

      // Async function to check customer existence and update purchase history
      const updatePurchaseHistoryAsync = async () => {
        try {
          const data = await fs.promises.readFile(CUSTOMERS_JSON_PATH, 'utf8');
          let customers = [];
          try {
            customers = JSON.parse(data);
          } catch (parseErr) {
            console.error('Error parsing customers.json:', parseErr);
            // Proceed to update purchase history anyway
            await updatePurchaseHistory();
            return;
          }

          const customerExists = customers.some(cust => {
            const custPhone = cust.phone ? cust.phone.replace(/\D/g, '') : '';
            const reqPhone = phone.replace(/\D/g, '');

            // Compare last 10 digits to handle country code differences
            const custPhoneLast10 = custPhone.slice(-10);
            const reqPhoneLast10 = reqPhone.slice(-10);

            return custPhoneLast10 === reqPhoneLast10;
          });

    if (customerExists) {
      console.log('Customer exists in database, updating purchase history');
      await updatePurchaseHistory();

      // Insert purchase history record into database
      try {
        // Find customer id by matching phone number in customers table
        const getCustomerId = () => {
          return new Promise((resolve, reject) => {
            const phoneNormalized = phone.replace(/\D/g, '').slice(-10);
            db.get(
              `SELECT id, phone FROM customers`,
              [],
              (err, row) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(row);
                }
              }
            );
          });
        };

        const getCustomerIdByPhone = () => {
          return new Promise((resolve, reject) => {
            const phoneNormalized = phone.replace(/\D/g, '').slice(-10);
            db.all(
              `SELECT id, phone FROM customers`,
              [],
              (err, rows) => {
                if (err) {
                  reject(err);
                } else {
                  const matched = rows.find(r => {
                    const custPhone = r.phone ? r.phone.replace(/\D/g, '').slice(-10) : '';
                    return custPhone === phoneNormalized;
                  });
                  resolve(matched ? matched.id : null);
                }
              }
            );
          });
        };

        // Find retailer id by email
        const getRetailerIdByEmail = () => {
          return new Promise((resolve, reject) => {
            db.get(
              `SELECT id FROM retailers WHERE email = ?`,
              [retailerEmail.toLowerCase()],
              (err, row) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(row ? row.id : null);
                }
              }
            );
          });
        };

        // Get medicine price from retailer's medicine DB
        const getMedicinePrice = () => {
          return new Promise(async (resolve, reject) => {
            try {
              const safeEmail = retailerEmail.replace(/[^a-zA-Z0-9]/g, '_');
              const retailerDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);
              const retailerCsvPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.csv`);
              const retailerMedicineDB = new MedicineDB(retailerDbPath, retailerCsvPath);
              await retailerMedicineDB.open();
              const medicines = await retailerMedicineDB.getAllMedicines();
              retailerMedicineDB.close();
              const medicine = medicines.find(med => med.name.toLowerCase() === medicineName.toLowerCase());
              resolve(medicine ? medicine.price : null);
            } catch (err) {
              resolve(null);
            }
          });
        };

        const customerId = await getCustomerIdByPhone();
        const retailerId = await getRetailerIdByEmail();
        const price = await getMedicinePrice();

        if (customerId && retailerId) {
          console.log(`Inserting purchase history record for customerId=${customerId}, retailerId=${retailerId}, medicineName=${medicineName}, price=${price}, expiryDate=${expiryDate}`);
          db.run(
            `INSERT INTO purchase_history (customer_id, retailer_id, medicine_name, quantity, price, expiry_date, message) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [customerId, retailerId, medicineName, quantity || 1, price, expiryDate, message],
            function (err) {
              if (err) {
                console.error('Error inserting purchase history:', err);
              } else {
                console.log('Purchase history record inserted with id:', this.lastID);
              }
            }
          );
        } else {
          console.log('Could not find customer or retailer id for purchase history insertion');
        }
      } catch (err) {
        console.error('Error updating purchase history in database:', err);
      }
    } else {
      console.log('Customer does not exist in database, skipping purchase history update');
    }
        } catch (err) {
          console.error('Error reading customers.json:', err);
          // Proceed to update purchase history anyway
          await updatePurchaseHistory();
        }
      };

      const updatePurchaseHistory = async () => {
        const safeEmail = retailerEmail.replace(/[^a-zA-Z0-9]/g, '_');
        const retailerCustomerCsvPath = path.join(__dirname, 'retailers', `customers_${safeEmail}.csv`);
        const globalCustomerCsvPath = path.join(__dirname, 'retailers', `customers_global.csv`);

        const csvLine = `"${customerName}","","${phone}","${medicineName}","1","${expiryDate}","${message.replace(/"/g, '""')}"\n`;

        try {
          // Update retailer-specific customer CSV
          if (!fs.existsSync(retailerCustomerCsvPath)) {
            console.log('Retailer customer CSV file does not exist, creating with headers');
            const headers = '"Customer Name","Location","Phone","Medicine Name","Quantity","Expiry Date","Message"\n';
            await fs.promises.writeFile(retailerCustomerCsvPath, headers);
          }
          await fs.promises.appendFile(retailerCustomerCsvPath, csvLine);
          console.log(`Purchase history updated for customer ${customerName} in ${retailerCustomerCsvPath}`);

          // Update global customer CSV only if phone number matches last 10 digits in customers.json
          if (!fs.existsSync(globalCustomerCsvPath)) {
            console.log('Global customer CSV file does not exist, creating with headers');
            const headers = '"Customer Name","Location","Phone","Medicine Name","Quantity","Expiry Date","Message"\n';
            await fs.promises.writeFile(globalCustomerCsvPath, headers);
          }

          // Read customers.json to verify phone number match
          const customersData = await fs.promises.readFile(CUSTOMERS_JSON_PATH, 'utf8');
          let customersList = [];
          try {
            customersList = JSON.parse(customersData);
          } catch (parseErr) {
            console.error('Error parsing customers.json:', parseErr);
          }

          const phoneNormalized = phone.replace(/\D/g, '').slice(-10);
          const customerMatch = customersList.some(cust => {
            const custPhone = cust.phone ? cust.phone.replace(/\D/g, '').slice(-10) : '';
            return custPhone === phoneNormalized;
          });

          if (customerMatch) {
            await fs.promises.appendFile(globalCustomerCsvPath, csvLine);
            console.log(`Purchase history updated for customer ${customerName} in global customer CSV`);
          } else {
            console.log(`Phone number ${phone} not found in customers.json, skipping global CSV update`);
          }
        } catch (err) {
          console.error('Error writing customer data to CSV:', err);
        }
      };

      await updatePurchaseHistoryAsync();
    } else {
      console.log('Insufficient data to update purchase history');
    }

    res.json({ success: true, message: 'Message sent successfully!' });
  } catch (err) {
    console.error('Failed to send message via WhatsApp API:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(500).json({ success: false, message: 'Failed to send message', error: err });
  }
});
  
// New endpoint to check if customers_global.csv exists and return its contents or status
app.get('/check-global-purchase-history', async (req, res) => {
  const globalCustomerCsvPath = path.join(__dirname, 'retailers', 'customers_global.csv');
  try {
    if (!fs.existsSync(globalCustomerCsvPath)) {
      return res.json({ success: false, message: 'Global customer purchase history file does not exist' });
    }
    const data = await fs.promises.readFile(globalCustomerCsvPath, 'utf8');
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error reading global customer purchase history:', err);
    res.status(500).json({ success: false, message: 'Failed to read global purchase history', error: err.message });
  }
});

app.post('/signup', async (req, res) => {
  const { userType, email, phone, shopKeeperName, shopName, password } = req.body;

  if (!userType || !email || !phone || !shopKeeperName || !password || (userType === 'retailer' && !shopName)) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const tableName = userType === 'retailer' ? 'retailers' : 'customers';

  try {
    // Check if email already exists
    db.get(`SELECT * FROM ${tableName} WHERE email = ?`, [email.toLowerCase()], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
      if (row) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }

      // Insert new user
      if (userType === 'retailer') {
        const stmt = db.prepare(`INSERT INTO retailers (email, phone, shopKeeperName, shopName, password, live, location) VALUES (?, ?, ?, ?, ?, 0, NULL)`);
        stmt.run(email.toLowerCase(), phone, shopKeeperName, shopName, password, function(insertErr) {
          if (insertErr) {
            console.error('Insert error:', insertErr);
            return res.status(500).json({ success: false, message: 'Failed to register retailer' });
          }
          res.json({ success: true, message: 'Signup successful' });
        });
        stmt.finalize();
      } else {
        const stmt = db.prepare(`INSERT INTO customers (email, phone, shopKeeperName, password) VALUES (?, ?, ?, ?)`);
        stmt.run(email.toLowerCase(), phone, shopKeeperName, password, function(insertErr) {
          if (insertErr) {
            console.error('Insert error:', insertErr);
            return res.status(500).json({ success: false, message: 'Failed to register customer' });
          }
          res.json({ success: true, message: 'Signup successful' });
        });
        stmt.finalize();
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/update-retailer-status', (req, res) => {
  const { email, location, live } = req.body;
  if (!email || typeof live !== 'boolean') {
    return res.status(400).json({ success: false, message: 'Missing email or live status' });
  }

  const emailLower = email.trim().toLowerCase();

  const updateQuery = `UPDATE retailers SET live = ?, location = ? WHERE LOWER(email) = ?`;

  db.run(updateQuery, [live ? 1 : 0, location || null, emailLower], function(err) {
    if (err) {
      console.error('Error updating retailer status in database:', err);
      return res.status(500).json({ success: false, message: 'Failed to update retailer status' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Retailer not found' });
    }

    res.json({ success: true, message: 'Retailer status updated successfully' });
  });
});

// Endpoint to get all live retailers with location
app.get('/live-retailers', (req, res) => {
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

    const liveRetailers = retailers.filter(r => r.live === true);
    res.json({ success: true, data: liveRetailers });
  });
});

app.post('/login', (req, res) => {
  const { userType, email, password } = req.body;
  if (!userType || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing userType, email or password' });
  }

  const tableName = userType === 'retailer' ? 'retailers' : 'customers';

  try {
    db.get(`SELECT * FROM ${tableName} WHERE email = ? AND password = ?`, [email.toLowerCase(), password], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
      }
      if (!row) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }

      // Remove password from response
      const { password, ...userWithoutPassword } = row;
      res.json({ success: true, message: 'Login successful', user: userWithoutPassword });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// API Endpoint to check medicine expiry and send reminders to customers with medicines expiring within 30 days
const csvParser = require('csv-parser');
const { parse } = require('date-fns');

async function sendExpiryRemindersForRetailer(email) {
  if (!client.info || !client.info.wid) {
    console.log('WhatsApp client not ready');
    throw new Error('WhatsApp client not ready');
  }

  const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '_');
  const retailerCustomerCsvPath = path.join(__dirname, 'retailers', `customers_${safeEmail}.csv`);
  console.log('Looking for customer CSV at:', retailerCustomerCsvPath);

  if (!fs.existsSync(retailerCustomerCsvPath)) {
    console.log('Customer CSV not found for retailer:', safeEmail);
    throw new Error('No customer data found for this retailer');
  }

  // Get shop name from retailers DB
  const getShopName = () => {
    return new Promise((resolve, reject) => {
      db.get('SELECT shopName FROM retailers WHERE email = ?', [email.toLowerCase()], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.shopName : '');
        }
      });
    });
  };

  const shopName = await getShopName();

  const customersToNotify = [];
  const today = new Date();
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
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
          resolve({ success: true, message: 'No customers with medicines expiring within 30 days' });
          return;
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

          const message = `Dear ${customerName},\n\nThis is a reminder from ${shopName} that your purchased medicine "${medicineName}" is expiring on ${expiryDate}. Please consider renewing your stock.\n\nThank you for choosing our service.`;

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
        resolve({ success: true, message: `Expiry reminders sent. Success: ${sentCount}, Failed: ${failedCount}` });
      })
      .on('error', (err) => {
        console.error('Error reading customer CSV:', err);
        reject(err);
      });
  });
}

app.post('/check-expiry', async (req, res) => {
  const { email } = req.body;
  console.log('Received /check-expiry request for email:', email);
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing retailer email' });
  }

  try {
    const result = await sendExpiryRemindersForRetailer(email);
    res.json(result);
  } catch (err) {
    console.error('Error sending expiry reminders:', err);
    res.status(500).json({ success: false, message: 'Failed to send expiry reminders', error: err.message });
  }
});

// Schedule daily job to send expiry reminders for all live retailers
const cron = require('node-cron');

async function sendExpiryRemindersForAllRetailers() {
  try {
    const data = await fs.promises.readFile(RETAILERS_JSON_PATH, 'utf8');
    const retailers = JSON.parse(data);
    const liveRetailers = retailers.filter(r => r.live === true);

    for (const retailer of liveRetailers) {
      try {
        console.log(`Sending expiry reminders for retailer: ${retailer.email}`);
        await sendExpiryRemindersForRetailer(retailer.email);
      } catch (err) {
        console.error(`Failed to send expiry reminders for retailer ${retailer.email}:`, err);
      }
    }
  } catch (err) {
    console.error('Error reading retailers.json for expiry reminders:', err);
  }
}

// Schedule the job to run daily at 8 AM server time
cron.schedule('0 8 * * *', () => {
  console.log('Running scheduled job: sendExpiryRemindersForAllRetailers');
  sendExpiryRemindersForAllRetailers();
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

// New API endpoint to get medicines expiring within 4 months for a retailer
app.get('/medicines-expiring-soon', async (req, res) => {
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
    const allMedicines = await retailerMedicineDB.getAllMedicines();
    const today = new Date();
    const fourMonthsLater = new Date(today);
    fourMonthsLater.setMonth(fourMonthsLater.getMonth() + 4);

    // Filter medicines expiring within 4 months
    const expiringSoonMedicines = allMedicines.filter(med => {
      if (!med.expiry_date) return false;
      const expiryDate = new Date(med.expiry_date);
      return expiryDate >= today && expiryDate <= fourMonthsLater;
    });

    retailerMedicineDB.close();
    res.json({ success: true, data: expiringSoonMedicines });
  } catch (err) {
    console.error('Error fetching expiring soon medicines:', err.stack || err);
    res.status(500).json({ success: false, message: 'Failed to fetch expiring soon medicines', error: err.message });
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

  db.get('SELECT * FROM retailers WHERE email = ?', [email], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    if (!row) {
      console.log('Retailer not found for email:', email);
      return res.status(404).json({ success: false, message: 'Retailer not found' });
    }
    // Return retailer details except password
    const { password, ...retailerDetails } = row;
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
  console.log('Received /customer-purchases request with query:', req.query);
  const { phone } = req.query;
  if (!phone) {
    console.log('Missing phone parameter in /customer-purchases request');
    return res.status(400).json({ success: false, message: 'Missing phone parameter' });
  }

  const phoneNormalized = phone.replace(/\D/g, '').slice(-10);

  const query = `
    SELECT ph.id, c.phone as customerPhone, r.email as retailerEmail, ph.medicine_name, ph.quantity, ph.price, ph.expiry_date, ph.message, ph.purchase_date
    FROM purchase_history ph
    JOIN customers c ON ph.customer_id = c.id
    JOIN retailers r ON ph.retailer_id = r.id
    WHERE SUBSTR(c.phone, -10) = ?
    ORDER BY ph.purchase_date DESC
  `;

  db.all(query, [phoneNormalized], (err, rows) => {
    if (err) {
      console.error('Error querying purchase history:', err);
      return res.status(500).json({ success: false, message: 'Failed to query purchase history', error: err.message });
    }
    res.json({ success: true, data: rows });
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

app.post('/search-medicine', async (req, res) => {
  const { medicineName, location } = req.body;
  if (!medicineName) {
    return res.status(400).json({ success: false, message: 'Missing medicineName in request body' });
  }

  const sqlite3 = require('sqlite3').verbose();
  const results = [];

  // Query database for active retailers (live = 1)
  db.all('SELECT * FROM retailers WHERE live = 1', async (err, retailers) => {
    if (err) {
      console.error('Error querying active retailers:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }

    // Helper function to query medicine DB for a retailer
    const queryRetailerMedicines = (retailer) => {
      return new Promise((resolve) => {
        const safeEmail = retailer.email.replace(/[^a-zA-Z0-9]/g, '_');
        const retailerDbPath = path.join(__dirname, 'retailers', `medicines_${safeEmail}.db`);

        if (!fs.existsSync(retailerDbPath)) {
          // No DB for this retailer, skip
          return resolve();
        }

        const db = new sqlite3.Database(retailerDbPath, sqlite3.OPEN_READONLY, (dbErr) => {
          if (dbErr) {
            console.error(`Error opening DB for retailer ${retailer.email}:`, dbErr);
            return resolve();
          }
        });

        const searchTerm = `%${medicineName.toLowerCase()}%`;
        const query = `SELECT id, name, price, quantity FROM medicines WHERE LOWER(name) LIKE ?`;

        db.all(query, [searchTerm], (queryErr, rows) => {
          if (queryErr) {
            console.error(`Error querying medicines for retailer ${retailer.email}:`, queryErr);
            db.close();
            return resolve();
          }

          rows.forEach(row => {
            results.push({
              retailerEmail: retailer.email,
              retailerName: retailer.shopKeeperName || '',
              retailerShopName: retailer.shopName || '',
              retailerLocation: retailer.location || '',
              medicineId: row.id,
              medicineName: row.name,
              price: row.price,
              quantity: row.quantity
            });
          });

          db.close();
          resolve();
        });
      });
    };

    // Query all active retailers in parallel
    await Promise.all(retailers.map(r => queryRetailerMedicines(r)));

    res.json({ success: true, data: results });
  });
});

app.get('/check-retailer', (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ success: false, message: 'Missing email parameter' });
  }
  db.get('SELECT * FROM retailers WHERE email = ?', [email.toLowerCase()], (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    if (!row) {
      return res.status(404).json({ success: false, message: 'Retailer not found' });
    }
    const { password, ...retailerWithoutPassword } = row;
    res.json({ success: true, retailer: retailerWithoutPassword });
  });
});

app.get('/purchase-history', (req, res) => {
  const { customerPhone, retailerEmail } = req.query;

  let query = `
    SELECT ph.id, c.phone as customerPhone, r.email as retailerEmail, ph.medicine_name, ph.price, ph.expiry_date, ph.message, ph.purchase_date
    FROM purchase_history ph
    JOIN customers c ON ph.customer_id = c.id
    JOIN retailers r ON ph.retailer_id = r.id
  `;

  const conditions = [];
  const params = [];

  if (customerPhone) {
    const phoneNormalized = customerPhone.replace(/\D/g, '').slice(-10);
    conditions.push(`SUBSTR(c.phone, -10) = ?`);
    params.push(phoneNormalized);
  }

  if (retailerEmail) {
    conditions.push(`r.email = ?`);
    params.push(retailerEmail.toLowerCase());
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY ph.purchase_date DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error querying purchase history:', err);
      return res.status(500).json({ success: false, message: 'Failed to query purchase history', error: err.message });
    }
    res.json({ success: true, data: rows });
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
