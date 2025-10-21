// connection.js
const mysql = require("mysql2");
const util = require("util");

// Create MySQL connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST ,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Connect
connection.connect((err) => {
  if (err) {
    console.error("Error connecting to MySQL:", err.message);
  } else {
    console.log("Connected to MySQL database");
  }
});

// Promisify MySQL methods for easier usage
const query = util.promisify(connection.query).bind(connection);

// Create SQLite-like wrapper
const db = {
  serialize(callback) {
    // MySQL doesn't need serialize (it's concurrent-safe),
    // but we'll just call the callback immediately for compatibility
    callback();
  },

  run(sql, params = [], callback = () => {}) {
    // INSERT, UPDATE, DELETE
    connection.query(sql, params, (err, results) => {
      if (err) return callback(err);
      // Mimic sqlite3's "this.lastID" behavior
      callback.call(
        { lastID: results?.insertId || null, changes: results?.affectedRows || 0 },
        err
      );
    });
  },

  get(sql, params = [], callback = () => {}) {
    connection.query(sql, params, (err, results) => {
      if (err) return callback(err);
      callback(null, results[0] || null);
    });
  },

  all(sql, params = [], callback = () => {}) {
    connection.query(sql, params, (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },
};

module.exports = db;
