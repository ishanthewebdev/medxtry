const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

class MedicineDB {
  constructor(dbPath = path.join(__dirname, 'medicines.db'), csvPath = path.join(__dirname, 'medicines.csv')) {
    this.dbPath = dbPath;
    this.csvPath = csvPath;
    this.db = null;
    this.open();
  }

  open() {
    if (this.db) {
      return this.ready;
    }
    this.ready = new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err.message);
          reject(err);
        } else {
          console.log(`Connected to SQLite database at ${this.dbPath}.`);
          resolve();
        }
      });
    });
    return this.ready;
  }

  initialize() {
    const dropTableSql = `DROP TABLE IF EXISTS medicines;`;
    const createTableSql = `
      CREATE TABLE medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        expiry_date TEXT,
        quantity INTEGER,
        price REAL
      )
    `;
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(dropTableSql, (dropErr) => {
          if (dropErr) {
            reject(dropErr);
            return;
          }
          this.db.run(createTableSql, (createErr) => {
            if (createErr) {
              reject(createErr);
            } else {
              resolve();
            }
          });
        });
      });
    });
  }

  importFromCSV() {
    return new Promise((resolve, reject) => {
      const medicines = [];
      fs.createReadStream(this.csvPath)
        .pipe(csv())
        .on('data', (row) => {
          // Map CSV columns to DB columns
          const mappedRow = {
            name: row['Medicine Name'] ? row['Medicine Name'].trim() : '',
            description: row['Company'] ? row['Company'].trim() : '',
            expiry_date: row['Expiry Date'] ? row['Expiry Date'].trim() : '',
            quantity: row['Quantity'] ? parseInt(row['Quantity'], 10) : 0,
            price: row['Price'] ? parseFloat(row['Price']) : 0
          };
          // Validate required fields
          if (mappedRow.name !== '') {
            medicines.push(mappedRow);
          } else {
            console.warn('Skipping row with missing name:', row);
          }
        })
        .on('end', () => {
          this.db.serialize(() => {
            this.db.run('DELETE FROM medicines'); // Clear existing data
            const stmt = this.db.prepare('INSERT INTO medicines (name, description, expiry_date, quantity, price) VALUES (?, ?, ?, ?, ?)');
            for (const med of medicines) {
              stmt.run(med.name, med.description, med.expiry_date, med.quantity, med.price);
            }
            stmt.finalize();
            console.log(`CSV data imported into database at ${this.dbPath}.`);
            resolve();
          });
        })
        .on('error', (err) => {
          reject(err);
        });
    });
  }

  getAllMedicines() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM medicines', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = MedicineDB;
