const fs = require('fs');
const path = require('path');

const testFilePath = path.join(__dirname, 'test-write.txt');

fs.writeFile(testFilePath, 'Test write access', (err) => {
  if (err) {
    console.error('Write test failed:', err);
  } else {
    console.log('Write test succeeded, file created:', testFilePath);
    // Delete the test file after creation to avoid clutter
    fs.unlink(testFilePath, (unlinkErr) => {
      if (unlinkErr) {
        console.error('Failed to delete test file:', unlinkErr);
      } else {
        console.log('Test file deleted successfully.');
      }
    });
  }
});
