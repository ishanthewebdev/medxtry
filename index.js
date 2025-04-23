window.addEventListener('load', () => {
  const overlay = document.querySelector('.brand-overlay');
  if (overlay) {
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 2500);
  }
});

let medicinesData = [];
let retailerShopName = '';
let retailerLocation = '';
let retailerLiveStatus = false;

// Fetch retailer details including shopName, location, live status
async function loadRetailerDetails() {
  let retailerEmail = sessionStorage.getItem('retailerEmail');
  if (retailerEmail) {
    retailerEmail = retailerEmail.trim().toLowerCase();
  }
  if (!retailerEmail) {
    alert('Retailer email not found. Please login again.');
    window.location.href = 'login.html';
    return;
  }
  try {
    const response = await fetch(`http://localhost:3000/retailer-details?email=${encodeURIComponent(retailerEmail)}`);
    if (!response.ok) {
      console.warn('Failed to load retailer details, status:', response.status);
      return;
    }
    const data = await response.json();
    if (data.success) {
      retailerShopName = data.data.shopName || '';
      const retailerOwnerName = data.data.shopKeeperName || '';
      const retailerPhone = data.data.phone || '';
      retailerLocation = data.data.location || '';
      retailerLiveStatus = data.data.live || false;
      console.log('Received retailer details:', data.data);

      // Store additional profile info in sessionStorage
      sessionStorage.setItem('retailerOwnerName', retailerOwnerName);
      sessionStorage.setItem('retailerPhone', retailerPhone);
      sessionStorage.setItem('retailerShopName', retailerShopName);
      sessionStorage.setItem('retailerLocation', retailerLocation);

      // Set location and live status inputs
      document.getElementById('retailerLocation').value = retailerLocation;
      document.getElementById('retailerLiveStatus').checked = retailerLiveStatus;

      // Display retailer name and location prominently
      document.getElementById('retailerNameDisplay').textContent = retailerShopName || 'Retailer';
      document.getElementById('retailerLocationDisplay').textContent = retailerLocation ? `Location: ${retailerLocation}` : '';
    } else {
      console.warn('Failed to load retailer details');
    }
  } catch (err) {
    console.error('Error loading retailer details:', err);
  }
}

// Fetch medicines and populate dropdown
async function loadMedicines() {
  const retailerEmail = sessionStorage.getItem('retailerEmail');
  if (!retailerEmail) {
    alert('Retailer email not found. Please login again.');
    window.location.href = 'login.html';
    return;
  }
  try {
    const response = await fetch(`http://localhost:3000/medicines?email=${encodeURIComponent(retailerEmail)}`);
    const data = await response.json();
    if (data.success) {
      medicinesData = data.data;
      const select = document.getElementById('medicineSelect');
      select.innerHTML = '<option value="">Select Medicine</option>';
      data.data.forEach(med => {
        const option = document.createElement('option');
        option.value = med.id;
        option.textContent = med.name + ' (Qty: ' + med.quantity + ')';
        select.appendChild(option);
      });
      updateExpiryDate(); // Reset expiry date display
    } else {
      alert('Failed to load medicines');
    }
  } catch (err) {
    console.error('Error loading medicines:', err);
    alert('Error loading medicines');
  }
}

// Update expiry date display based on selected medicine
function updateExpiryDate() {
  const select = document.getElementById('medicineSelect');
  const expiryDiv = document.getElementById('expiryDate');
  const selectedId = select.value;
  if (!selectedId) {
    expiryDiv.textContent = 'Expiry Date: N/A';
    return;
  }
  const med = medicinesData.find(m => m.id === parseInt(selectedId));
  if (med && med.expiry_date) {
    expiryDiv.textContent = 'Expiry Date: ' + med.expiry_date;
  } else {
    expiryDiv.textContent = 'Expiry Date: N/A';
  }
}

document.getElementById('medicineSelect').addEventListener('change', updateExpiryDate);

document.getElementById('messageForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const retailerEmail = sessionStorage.getItem('retailerEmail');
  if (!retailerEmail) {
    alert('Retailer email not found. Please login again.');
    window.location.href = 'login.html';
    return;
  }

  const customerName = document.getElementById('customerName').value.trim();
  const location = document.getElementById('location').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const medicineSelect = document.getElementById('medicineSelect');
  const medicineId = medicineSelect.value;
  const quantity = parseInt(document.getElementById('quantity').value.trim(), 10);
  const messageInput = document.getElementById('message').value.trim();

  if (!customerName) {
    alert('Please enter customer name');
    return;
  }
  if (!location) {
    alert('Please enter customer location');
    return;
  }
  if (!medicineId) {
    alert('Please select a medicine');
    return;
  }
  if (!quantity || quantity <= 0) {
    alert('Please enter a valid quantity');
    return;
  }

  const med = medicinesData.find(m => m.id === parseInt(medicineId));
  if (!med) {
    alert('Selected medicine not found');
    return;
  }

  // Compose professional message including all details
  const fullMessage = 
`Dear ${customerName},

Location: ${location},

Shop Name: ${retailerShopName},

Medicine Details:
- Name: ${med.name}
- Quantity: ${quantity}
- Expiry Date: ${med.expiry_date}

Message:
${messageInput}

Thank you for choosing our service.`;

  // Send message to customer first
  try {
    const response = await fetch('http://localhost:3000/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone, 
        message: fullMessage,
        retailerEmail,
        customerName,
        medicineName: med.name,
        expiryDate: med.expiry_date,
        quantity
      })
    });
    const data = await response.json();
    if (!data.success) {
      alert('Error sending message');
      return;
    }
  } catch (err) {
    console.error('Error sending message:', err);
    alert('Error sending message');
    return;
  }

  // Deduct quantity from database only if message sent successfully
  try {
    const deductResponse = await fetch('http://localhost:3000/deduct-medicine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: medicineId, quantity, email: retailerEmail })
    });
    const deductData = await deductResponse.json();
    if (!deductData.success) {
      alert('Failed to deduct quantity: ' + deductData.message);
      return;
    }
  } catch (err) {
    console.error('Error deducting quantity:', err);
    alert('Error deducting quantity');
    return;
  }

  // Save customer data to CSV
  try {
    const saveResponse = await fetch('http://localhost:3000/save-customer-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        location,
        phone,
        medicineName: med.name,
        quantity,
        expiryDate: med.expiry_date,
        message: messageInput,
        email: retailerEmail
      })
    });
    const saveData = await saveResponse.json();
    if (!saveData.success) {
      alert('Failed to save customer data: ' + saveData.message);
      return;
    }
  } catch (err) {
    console.error('Error saving customer data:', err);
    alert('Error saving customer data');
    return;
  }

  alert('Message sent and quantity updated successfully!');

  // Reset form fields
  document.getElementById('customerName').value = '';
  document.getElementById('location').value = '';
  medicineSelect.value = '';
  updateExpiryDate();
  document.getElementById('quantity').value = '';
  document.getElementById('message').value = '';
  document.getElementById('phone').value = '';

  // Reload medicines to update quantities and dropdown
  await loadMedicines();
});

// Load medicines on page load
window.onload = async () => {
  await loadRetailerDetails();
  await loadMedicines();
};

// Handle medicine CSV upload form submission
document.getElementById('uploadCsvForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const retailerEmail = sessionStorage.getItem('retailerEmail');
  if (!retailerEmail) {
    alert('Retailer email not found. Please login again.');
    window.location.href = 'login.html';
    return;
  }

  const fileInput = document.getElementById('medicineCsvFile');
  if (fileInput.files.length === 0) {
    alert('Please select a CSV file to upload.');
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  formData.append('email', retailerEmail);

  const uploadStatus = document.getElementById('uploadStatus');
  uploadStatus.textContent = 'Uploading...';

  try {
    const response = await fetch('http://localhost:3000/upload-medicine-csv', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (data.success) {
      uploadStatus.textContent = 'Upload successful! Reloading medicines...';
      await loadMedicines();
      uploadStatus.textContent = 'Medicines updated from uploaded CSV.';
      fileInput.value = ''; // Clear file input
    } else {
      uploadStatus.textContent = 'Upload failed: ' + (data.message || 'Unknown error');
    }
  } catch (err) {
    console.error('Error uploading CSV:', err);
    uploadStatus.textContent = 'Error uploading CSV.';
  }
});

// Handle retailer status form submission
document.getElementById('retailerStatusForm').addEventListener('submit', async function(e) {
  e.preventDefault();

  const retailerEmail = sessionStorage.getItem('retailerEmail');
  if (!retailerEmail) {
    alert('Retailer email not found. Please login again.');
    window.location.href = 'login.html';
    return;
  }

  const location = document.getElementById('retailerLocation').value.trim();
  const live = document.getElementById('retailerLiveStatus').checked;

  try {
    const response = await fetch('http://localhost:3000/update-retailer-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: retailerEmail, location, live })
    });
    const data = await response.json();
    const statusMessage = document.getElementById('statusMessage');
    if (data.success) {
      statusMessage.textContent = 'Status updated successfully.';
      statusMessage.style.color = '#6ee7b7'; // success color
    } else {
      statusMessage.textContent = 'Failed to update status: ' + (data.message || '');
      statusMessage.style.color = '#ff6b6b'; // error color
    }
  } catch (err) {
    console.error('Error updating retailer status:', err);
    const statusMessage = document.getElementById('statusMessage');
    statusMessage.textContent = 'Error updating status.';
    statusMessage.style.color = '#ff6b6b'; // error color
  }
});

// Handle detect location button click
document.getElementById('detectLocationBtn').addEventListener('click', () => {
  const statusMessage = document.getElementById('statusMessage');
  if (!navigator.geolocation) {
    statusMessage.textContent = 'Geolocation is not supported by your browser.';
    statusMessage.style.color = '#ff6b6b';
    return;
  }
  statusMessage.textContent = 'Detecting location...';
  statusMessage.style.color = '#a3bffa';

  navigator.geolocation.getCurrentPosition(async (position) => {
    const { latitude, longitude } = position.coords;
    // Use a reverse geocoding API to get address from coordinates
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
      const data = await response.json();
      if (data && data.display_name) {
        document.getElementById('retailerLocation').value = data.display_name;
        statusMessage.textContent = 'Location detected and filled.';
        statusMessage.style.color = '#6ee7b7';
      } else {
        document.getElementById('retailerLocation').value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        statusMessage.textContent = 'Location detected (coordinates).';
        statusMessage.style.color = '#6ee7b7';
      }
    } catch (error) {
      document.getElementById('retailerLocation').value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      statusMessage.textContent = 'Location detected (coordinates).';
      statusMessage.style.color = '#6ee7b7';
    }
  }, (error) => {
    switch(error.code) {
      case error.PERMISSION_DENIED:
        statusMessage.textContent = 'Permission denied for location access.';
        break;
      case error.POSITION_UNAVAILABLE:
        statusMessage.textContent = 'Location information is unavailable.';
        break;
      case error.TIMEOUT:
        statusMessage.textContent = 'Location request timed out.';
        break;
      default:
        statusMessage.textContent = 'An unknown error occurred.';
        break;
    }
    statusMessage.style.color = '#ff6b6b';
  });
});

document.getElementById('closeSalesModal').addEventListener('click', () => {
  document.getElementById('salesModal').style.display = 'none';
});

// Navbar navigation handlers
document.getElementById('navLogout').addEventListener('click', () => {
  sessionStorage.clear();
  window.location.href = 'login.html';
});
document.getElementById('navProfile').addEventListener('click', (e) => {
  e.preventDefault();
  showProfile();
  setActiveTab(document.getElementById('navProfile'));
  document.getElementById('dashboardContent').style.display = 'none';
  document.getElementById('expireSoonSection').style.display = 'none';
  document.getElementById('sendReminderSection').style.display = 'none';
  document.getElementById('retailerStatusSection').style.display = 'none';
  document.getElementById('uploadCsvForm').parentElement.style.display = 'none';
  document.getElementById('salesModal').style.display = 'none';
});

document.getElementById('navSales').addEventListener('click', async () => {
  document.getElementById('salesModal').style.display = 'block';
  setActiveTab(document.getElementById('navSales'));
  document.getElementById('uploadCsvForm').parentElement.style.display = 'none';

  const salesTableBody = document.querySelector('#salesTable tbody');
  const salesLoading = document.getElementById('salesLoading');
  const salesError = document.getElementById('salesError');

  salesTableBody.innerHTML = '';
  salesError.style.display = 'none';
  salesLoading.style.display = 'block';

  const retailerEmail = sessionStorage.getItem('retailerEmail');
  if (!retailerEmail) {
    salesLoading.style.display = 'none';
    salesError.textContent = 'Retailer email not found. Please login again.';
    salesError.style.display = 'block';
    return;
  }

  try {
    const response = await fetch(`http://localhost:3000/sales-data?email=${encodeURIComponent(retailerEmail)}`);
    const data = await response.json();
    console.log('Sales data received from backend:', data);
    salesLoading.style.display = 'none';

    if (!data.success) {
      salesError.textContent = data.message || 'Failed to load sales data.';
      salesError.style.display = 'block';
      return;
    }

    if (data.data.length === 0) {
      salesError.textContent = 'No sales data available.';
      salesError.style.display = 'block';
      return;
    }

data.data.forEach(sale => {
  const row = document.createElement('tr');
  const dateCell = document.createElement('td');
  dateCell.textContent = sale.date;
  dateCell.style.padding = '8px';
  const nameCell = document.createElement('td');
  nameCell.textContent = sale.medicineName;
  nameCell.style.padding = '8px';
  const quantityCell = document.createElement('td');
  quantityCell.textContent = sale.totalQuantity;
  quantityCell.style.padding = '8px';
  quantityCell.style.textAlign = 'right';
  const priceCell = document.createElement('td');
  priceCell.textContent = (sale.price !== undefined && sale.price !== null) ? sale.price.toFixed(2) : 'N/A';
  priceCell.style.padding = '8px';
  priceCell.style.textAlign = 'right';
  const totalPriceCell = document.createElement('td');
  totalPriceCell.textContent = (sale.totalPrice !== undefined && sale.totalPrice !== null) ? sale.totalPrice.toFixed(2) : 'N/A';
  totalPriceCell.style.padding = '8px';
  totalPriceCell.style.textAlign = 'right';

  row.appendChild(dateCell);
  row.appendChild(nameCell);
  row.appendChild(quantityCell);
  row.appendChild(priceCell);
  row.appendChild(totalPriceCell);

  salesTableBody.appendChild(row);
});
  } catch (err) {
    salesLoading.style.display = 'none';
    salesError.textContent = 'Error loading sales data.';
    salesError.style.display = 'block';
    console.error('Error fetching sales data:', err);
  }
});

document.getElementById('navExpireSoon').addEventListener('click', async () => {
  document.getElementById('sendReminderSection').style.display = 'none';
  document.getElementById('expireSoonSection').style.display = 'block';
  document.getElementById('dashboardContent').style.display = 'none';
  document.getElementById('retailerStatusSection').style.display = 'none';
  document.getElementById('uploadCsvForm').parentElement.style.display = 'none';
  document.getElementById('salesModal').style.display = 'none';
  setActiveTab(document.getElementById('navExpireSoon'));

  const expireSoonTableBody = document.querySelector('#expireSoonTable tbody');
  const expireSoonLoading = document.getElementById('expireSoonLoading');
  const expireSoonError = document.getElementById('expireSoonError');

  expireSoonTableBody.innerHTML = '';
  expireSoonError.style.display = 'none';
  expireSoonLoading.style.display = 'block';

  const retailerEmail = sessionStorage.getItem('retailerEmail');
  if (!retailerEmail) {
    expireSoonLoading.style.display = 'none';
    expireSoonError.textContent = 'Retailer email not found. Please login again.';
    expireSoonError.style.display = 'block';
    return;
  }

  try {
    const response = await fetch(`http://localhost:3000/medicines-expiring-soon?email=${encodeURIComponent(retailerEmail)}`);
    const data = await response.json();
    console.log('Expiring medicines data received from backend:', data);
    expireSoonLoading.style.display = 'none';

    if (!data.success) {
      expireSoonError.textContent = data.message || 'Failed to load expiring medicines.';
      expireSoonError.style.display = 'block';
      return;
    }

    if (data.data.length === 0) {
      expireSoonError.textContent = 'No medicines expiring within 4 months.';
      expireSoonError.style.display = 'block';
      return;
    }

    data.data.forEach(med => {
      console.log('Appending medicine row:', med);
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = med.name;
      nameCell.style.padding = '8px';
      const quantityCell = document.createElement('td');
      quantityCell.textContent = med.quantity;
      quantityCell.style.padding = '8px';
      quantityCell.style.textAlign = 'right';
      const expiryCell = document.createElement('td');
      expiryCell.textContent = med.expiry_date;
      expiryCell.style.padding = '8px';
      row.appendChild(nameCell);
      row.appendChild(quantityCell);
      row.appendChild(expiryCell);
      expireSoonTableBody.appendChild(row);
    });
  } catch (err) {
    expireSoonLoading.style.display = 'none';
    expireSoonError.textContent = 'Error loading expiring medicines.';
    expireSoonError.style.display = 'block';
    console.error('Error fetching expiring medicines:', err);
  }
});

document.getElementById('navUploadCsv').addEventListener('click', () => {
  document.getElementById('uploadCsvForm').parentElement.style.display = 'block';
  document.getElementById('dashboardContent').style.display = 'none';
  document.getElementById('expireSoonSection').style.display = 'none';
  document.getElementById('sendReminderSection').style.display = 'none';
  document.getElementById('retailerStatusSection').style.display = 'none';
  document.getElementById('salesModal').style.display = 'none';
  setActiveTab(document.getElementById('navUploadCsv'));
});

// Retailer Profile Section
function showProfile() {
  document.getElementById('dashboardContent').style.display = 'none';
  document.getElementById('expireSoonSection').style.display = 'none';
  const profileContent = document.getElementById('profileContent');
  profileContent.style.display = 'block';
  profileContent.classList.remove('hidden');
  document.getElementById('uploadCsvForm').parentElement.style.display = 'none';
  document.getElementById('salesModal').style.display = 'none';
  setActiveTab(document.getElementById('navProfile'));
  loadProfile();
}

document.getElementById('viewSalesBtn').addEventListener('click', () => {
  document.getElementById('salesModal').style.display = 'block';
  setActiveTab(document.getElementById('navSales'));
});

// Load retailer profile data from sessionStorage or API
function loadProfile() {
  const shopName = sessionStorage.getItem('retailerShopName') || '';
  const ownerName = sessionStorage.getItem('retailerOwnerName') || '';
  const phone = sessionStorage.getItem('retailerPhone') || '';
  const location = sessionStorage.getItem('retailerLocation') || '';
  const email = sessionStorage.getItem('retailerEmail') || '';

  document.getElementById('profileShopName').textContent = shopName;
  document.getElementById('profileOwnerName').textContent = ownerName;
  document.getElementById('profilePhone').textContent = phone;
  document.getElementById('profileLocation').textContent = location;
  document.getElementById('profileEmail').textContent = email;
}

// Reset password form submission handler
document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resetPasswordMessage = document.getElementById('resetPasswordMessage');
  resetPasswordMessage.textContent = '';

  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;

  if (newPassword !== confirmNewPassword) {
    resetPasswordMessage.textContent = 'New passwords do not match.';
    resetPasswordMessage.className = 'text-red-600 mt-2';
    return;
  }

  const email = sessionStorage.getItem('retailerEmail');
  if (!email) {
    resetPasswordMessage.textContent = 'User email not found. Please login again.';
    resetPasswordMessage.className = 'text-red-600 mt-2';
    return;
  }

  try {
    const response = await fetch('http://localhost:3000/retailer-reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, currentPassword, newPassword })
    });
    const result = await response.json();
    if (result.success) {
      resetPasswordMessage.textContent = 'Password reset successful.';
      resetPasswordMessage.className = 'text-green-600 mt-2';
      document.getElementById('resetPasswordForm').reset();
    } else {
      resetPasswordMessage.textContent = 'Password reset failed: ' + result.message;
      resetPasswordMessage.className = 'text-red-600 mt-2';
    }
  } catch (error) {
    resetPasswordMessage.textContent = 'Error resetting password: ' + error.message;
    resetPasswordMessage.className = 'text-red-600 mt-2';
  }
});

// Function to set active tab styling
function setActiveTab(tabElement) {
  const navItems = document.querySelectorAll('nav ul li');
  navItems.forEach(item => item.classList.remove('active'));
  if (tabElement) {
    tabElement.classList.add('active');
  }
}
