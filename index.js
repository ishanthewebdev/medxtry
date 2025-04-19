
const { Client, LocalAuth } = require('whatsapp-web.js');

const customers = [];

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: true, // Change to true after you scan QR code
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});



// When ready
client.on('ready', () => {
  console.log('🎉 Client is ready!');

  // Add customers (you can dynamically load this later)
  addCustomer('Lodu', '916283893292', 'Paracetamol', '2024-04-25');
  
 // addCustomer('Ishan', '917753867670', 'Ibuprofen', '2024-04-20');

  // Check expiries now and every 24h
  checkExpiries();
  setInterval(checkExpiries, 24 * 60 * 60 * 1000);
});

// Add a customer and send a purchase message
function addCustomer(name, phone, medicineName, expiryDateStr) {
  const expiryDate = new Date(expiryDateStr);
  const customer = { name, phone, medicineName, expiryDate };
  customers.push(customer);

  const msg = `Hello ${name}, you have purchased "${medicineName}" which expires on ${expiryDate.toDateString()}.`;
  sendWhatsAppMessage(phone, msg);
}

// Send WhatsApp message
function sendWhatsAppMessage(phone, message) {
  const chatId = `${phone}@c.us`;
  client.sendMessage(chatId, message)
    .then(() => console.log(`✅ Message sent to ${chatId}`))
    .catch(err => console.error(`❌ Error sending to ${chatId}:`, err));
}

// Check for upcoming expiries
function checkExpiries() {
  const today = new Date();
  const warningPeriod = 10 * 24 * 60 * 60 * 1000;

  customers.forEach(({ name, phone, medicineName, expiryDate }) => {
    const timeToExpiry = expiryDate - today;
    if (timeToExpiry >= 0 && timeToExpiry <= warningPeriod) {
      const reminder = `Reminder: ${name}, your medicine "${medicineName}" will expire on ${expiryDate.toDateString()}.`;
      console.log(reminder);
      sendWhatsAppMessage(phone, reminder);
    }
  });
}

// Launch the WhatsApp bot
client.initialize();
