const express = require('express');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const app = express();
const port = 3000;

const db = require('./connection');

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'library-management-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3600000 } // 1 hour
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Drop existing tables and recreate them on startup
db.serialize(() => {
  // Drop tables if they exist
  db.run(`DROP TABLE IF EXISTS Books`);
  db.run(`DROP TABLE IF EXISTS Users`);
  
  console.log('Dropped existing tables');
  
  // Create Users table
  db.run(`CREATE TABLE Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
  )`);
  
  // Create Books table
  db.run(`CREATE TABLE Books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Available',
    borrowed_by_user_id INTEGER,
    due_date TEXT,
    FOREIGN KEY (borrowed_by_user_id) REFERENCES Users(id)
  )`);
  
  console.log('Created fresh tables');
  
  // Seed only admin user
  console.log('Seeding admin user...');
  const saltRounds = 10;
  
  // Seed admin user
  bcrypt.hash('admin123', saltRounds, (err, adminHash) => {
    if (err) {
      console.error('Error hashing admin password:', err.message);
    } else {
      db.run('INSERT INTO Users (username, password, role) VALUES (?, ?, ?)', 
        ['admin', adminHash, 'admin'], 
        function(err) {
          if (err) {
            console.error('Error seeding admin user:', err.message);
          } else {
            console.log('Admin user created with ID:', this.lastID);
          }
        }
      );
    }
  });

  // Always seed Books table
  console.log('Seeding books...');
  const sampleBooks = [
    { title: '1984', author: 'George Orwell' },
    { title: 'Dune', author: 'Frank Herbert' },
    { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
    { title: 'To Kill a Mockingbird', author: 'Harper Lee' },
    { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald' },
    { title: 'Pride and Prejudice', author: 'Jane Austen' },
    { title: 'The Catcher in the Rye', author: 'J.D. Salinger' },
    { title: 'Brave New World', author: 'Aldous Huxley' },
    { title: 'The Lord of the Rings', author: 'J.R.R. Tolkien' },
    { title: 'Animal Farm', author: 'George Orwell' }
  ];
  
  sampleBooks.forEach(book => {
    db.run('INSERT INTO Books (title, author) VALUES (?, ?)', 
      [book.title, book.author], 
      function(err) {
        if (err) {
          console.error(`Error seeding book ${book.title}:`, err.message);
        } else {
          console.log(`Book "${book.title}" created with ID:`, this.lastID);
        }
      }
    );
  });
  
  console.log('Database seeding complete!');
});

// Middleware functions
const isLoggedIn = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/login');
  }
};

const isAdmin = (req, res, next) => {
  if (req.session.role === 'admin') {
    next();
  } else {
    res.status(403).send('Forbidden: Admin access required');
  }
};

// Auth Routes (No middleware)

// Login page
app.get('/login', (req, res) => {
  res.render('login');
});

// Register page
app.get('/register', (req, res) => {
  res.render('register');
});

// Register post
app.post('/register', (req, res) => {
  const { username, password } = req.body;
  
  // Validate input
  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }

  // Hash password
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      console.error('Error hashing password:', err.message);
      return res.status(500).send('Error creating user');
    }
    
    // Insert new user
    db.run('INSERT INTO Users (username, password, role) VALUES (?, ?, ?)',
      [username, hash, 'member'],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).send('Username already exists');
          }
          console.error('Error creating user:', err.message);
          return res.status(500).send('Error creating user');
        }
        
        res.redirect('/login');
      }
    );
  });
});

// Login post
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Validate input
  if (!username || !password) {
    return res.status(400).send('Username and password are required');
  }
  
  // Find user
  db.get('SELECT * FROM Users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error('Error finding user:', err.message);
      return res.status(500).send('Error during login');
    }
    
    if (!user) {
      return res.status(401).send('Invalid username or password');
    }
    
    // Check password
    bcrypt.compare(password, user.password, (err, match) => {
      if (err) {
        console.error('Error comparing passwords:', err.message);
        return res.status(500).send('Error during login');
      }
      
      if (!match) {
        return res.status(401).send('Invalid username or password');
      }
      
      // Set session
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      
      res.redirect('/');
    });
  });
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error during logout:', err.message);
      return res.status(500).send('Error during logout');
    }
    res.redirect('/login');
  });
});

// App Routes (Protected by isLoggedIn)

// Dashboard
app.get('/', isLoggedIn, (req, res) => {
  const userId = req.session.userId;
  const userRole = req.session.role;
  
  // Fetch all books with borrower info
  db.all(`
    SELECT Books.*, Users.username as borrower_username 
    FROM Books 
    LEFT JOIN Users ON Books.borrowed_by_user_id = Users.id
  `, (err, books) => {
    if (err) {
      console.error('Error fetching books:', err.message);
      return res.status(500).send('Error fetching books');
    }
    
    // Calculate fines for overdue books
    const today = new Date();
    books.forEach(book => {
      if (book.due_date) {
        const dueDate = new Date(book.due_date);
        if (today > dueDate) {
          const diffTime = Math.abs(today - dueDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          book.fine = diffDays * 5; // $5 per day
        }
      }
    });
    
    // Filter books borrowed by the current user for "My Books" section
    const myBooks = userRole !== 'admin' ? books.filter(book => book.borrowed_by_user_id === userId) : [];
    
    res.render('index', { 
      books,
      myBooks,
      user: {
        id: userId,
        username: req.session.username,
        role: userRole
      }
    });
  });
});

// Borrow book
app.post('/borrow/:id', isLoggedIn, (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.userId;
  const userRole = req.session.role;
  
  // Check if user is an admin - admins can't borrow books
  if (userRole === 'admin') {
    return res.status(403).send('Admins cannot borrow books. Please use a member account.');
  }
  
  // Calculate due date (30 days from now)
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const dueDateString = dueDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  
  // Update book status
  db.run(
    'UPDATE Books SET status = ?, borrowed_by_user_id = ?, due_date = ? WHERE id = ?',
    ['Borrowed', userId, dueDateString, bookId],
    function(err) {
      if (err) {
        console.error('Error borrowing book:', err.message);
        return res.status(500).send('Error borrowing book');
      }
      
      res.redirect('/');
    }
  );
});

// Return book
app.post('/return/:id', isLoggedIn, (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.userId;
  const isAdmin = req.session.role === 'admin';
  
  // Find book
  db.get('SELECT * FROM Books WHERE id = ?', [bookId], (err, book) => {
    if (err) {
      console.error('Error finding book:', err.message);
      return res.status(500).send('Error returning book');
    }
    
    if (!book) {
      return res.status(404).send('Book not found');
    }
    
    // Auth check
    if (!isAdmin && book.borrowed_by_user_id !== userId) {
      return res.status(403).send('You are not authorized to return this book');
    }
    
    // Update book status
    db.run(
      'UPDATE Books SET status = ?, borrowed_by_user_id = NULL, due_date = NULL WHERE id = ?',
      ['Available', bookId],
      function(err) {
        if (err) {
          console.error('Error returning book:', err.message);
          return res.status(500).send('Error returning book');
        }
        
        res.redirect('/');
      }
    );
  });
});

// Admin Routes (Protected by isLoggedIn AND isAdmin)

// Admin dashboard
app.get('/admin', isLoggedIn, isAdmin, (req, res) => {
  res.render('admin', { 
    user: {
      id: req.session.userId,
      username: req.session.username,
      role: req.session.role
    }
  });
});

// Add book
app.post('/admin/addbook', isLoggedIn, isAdmin, (req, res) => {
  const { title, author } = req.body;
  
  // Validate input
  if (!title || !author) {
    return res.status(400).send('Title and author are required');
  }
  
  // Insert book
  db.run(
    'INSERT INTO Books (title, author) VALUES (?, ?)',
    [title, author],
    function(err) {
      if (err) {
        console.error('Error adding book:', err.message);
        return res.status(500).send('Error adding book');
      }
      
      res.redirect('/admin');
    }
  );
});

// Edit book form
app.get('/admin/edit/:id', isLoggedIn, isAdmin, (req, res) => {
  const bookId = req.params.id;
  
  db.get('SELECT * FROM Books WHERE id = ?', [bookId], (err, book) => {
    if (err) {
      console.error('Error fetching book:', err.message);
      return res.status(500).send('Error fetching book details');
    }
    
    if (!book) {
      return res.status(404).send('Book not found');
    }
    
    res.render('edit-book', { 
      book,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.role
      }
    });
  });
});

// Update book
app.post('/admin/edit/:id', isLoggedIn, isAdmin, (req, res) => {
  const bookId = req.params.id;
  const { title, author } = req.body;
  
  // Validate input
  if (!title || !author) {
    return res.status(400).send('Title and author are required');
  }
  
  db.run(
    'UPDATE Books SET title = ?, author = ? WHERE id = ?',
    [title, author, bookId],
    function(err) {
      if (err) {
        console.error('Error updating book:', err.message);
        return res.status(500).send('Error updating book');
      }
      
      res.redirect('/');
    }
  );
});

// Delete book
app.post('/admin/delete/:id', isLoggedIn, isAdmin, (req, res) => {
  const bookId = req.params.id;
  
  db.run('DELETE FROM Books WHERE id = ?', [bookId], function(err) {
    if (err) {
      console.error('Error deleting book:', err.message);
      return res.status(500).send('Error deleting book');
    }
    
    res.redirect('/');
  });
});

// Home route redirect to dashboard or login
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
});

// Start server
app.listen(port, () => {
  console.log(`Library Management System running on http://localhost:${port}`);
});