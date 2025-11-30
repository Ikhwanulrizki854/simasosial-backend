const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer'); 
const path = require('path'); 
const fs = require('fs');
const mysql = require('mysql2');
const { v4: uuidv4 } = require('uuid');
const midtransClient = require('midtrans-client');
const crypto = require('crypto');
const { Parser } = require('json2csv');
const verifyToken = require('./middleware/verifyToken');
const nodemailer = require('nodemailer');
const ExcelJS = require('exceljs');

require('dotenv').config();

const app = express();
const port = 8000; 

// --- KONFIGURASI ---

// Folder upload publik
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middleware
app.use(cors()); 
app.use(express.json()); 

// Hubungkan ke Database MySQL (CLOUD TiDB)
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000,
    // Ubah baris ssl menjadi seperti ini:
    ssl: {
        rejectUnauthorized: false 
    }
});

// --- RUTE TEST KONEKSI DATABASE ---
app.get('/test-users', (req, res) => {
    const query = "SELECT * FROM users";
    
    connection.query(query, (err, results) => {
        if (err) {
            console.error("Gagal ambil data:", err);
            return res.status(500).json({ error: "Gagal mengambil data dari database" });
        }
        res.json({
            status: "Sukses",
            message: "Koneksi ke TiDB Cloud Berhasil!",
            data: results
        });
    });
});

// KONFIGURASI FINAL: Port 587 + IPv4 
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,             
  secure: false,         
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false 
  },
  // Tambahan timeout supaya tidak cepat putus asa
  connectionTimeout: 10000, 
  greetingTimeout: 10000 
});

// Fungsi Helper untuk Kirim Email
const sendEmail = (to, subject, htmlContent) => {
  const mailOptions = {
    from: `"SIMASOSIAL FST" <${process.env.EMAIL_USER}>`,
    to: to,
    subject: subject,
    html: htmlContent
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Gagal kirim email:', error);
    } else {
      console.log('Email terkirim: ' + info.response);
    }
  });
};

connection.connect(error => {
  if (error) {
    console.error('Error connecting to database:', error);
    return;
  }
  console.log('Successfully connected to database (simasosial_db)!');
});

// Midtrans Setup
const snap = new midtransClient.Snap({
  isProduction: false, 
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY
});

// Multer Setup (Upload Gambar)
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, 'uploads/'); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
const upload = multer({ storage: storage });


// --- ROUTES: AUTHENTICATION ---

app.get('/', (req, res) => {
  res.json({ message: "Server Backend SIMASOSIAL FST Berjalan." });
});

// API ENDPOINT UNTUK REGISTRASI (UPDATE: VERIFIKASI EMAIL)
app.post('/api/register', async (req, res) => {
  const { nama, nim, jurusan, telepon, email, password } = req.body;

  if (!nama || !nim || !email || !password) {
    return res.status(400).json({ message: 'Data tidak lengkap.' });
  }

  let angkatan = (nim && nim.length >= 2) ? "20" + nim.substring(0, 2) : null;

  try {
    // Cek dulu apakah email sudah ada
    const checkQuery = 'SELECT id FROM users WHERE email = ? OR nim = ?';
    connection.query(checkQuery, [email, nim], async (errCheck, resCheck) => {
      if (resCheck.length > 0) return res.status(409).json({ message: 'Email atau NIM sudah terdaftar.' });

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // BUAT TOKEN VERIFIKASI
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // SIMPAN DENGAN STATUS is_verified = 0
      const query = 'INSERT INTO users (nama_lengkap, nim, jurusan, angkatan, no_telepon, email, password, verification_token, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)';
      const values = [nama, nim, jurusan, angkatan, telepon, email, hashedPassword, verificationToken];

      connection.query(query, values, (error, results) => {
        if (error) {
          console.error('Error register:', error);
          return res.status(500).json({ message: 'Gagal mendaftar.' });
        }

        // KIRIM EMAIL VERIFIKASI
        // Link mengarah ke Frontend React
        const verifyLink = `http://localhost:5173/verify-email?token=${verificationToken}`;
        
        const isiEmail = `
          <h3>Verifikasi Akun SIMASOSIAL Anda</h3>
          <p>Halo ${nama},</p>
          <p>Terima kasih telah mendaftar. Silakan klik tombol di bawah ini untuk mengaktifkan akun Anda:</p>
          <a href="${verifyLink}" style="background:#0d47a1;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin:10px 0;">Verifikasi Email</a>
          <p>Atau klik link ini: <a href="${verifyLink}">${verifyLink}</a></p>
          <p>Jika Anda tidak merasa mendaftar, abaikan email ini.</p>
        `;
        
        sendEmail(email, 'Verifikasi Email - SIMASOSIAL', isiEmail);

        res.status(201).json({ message: 'Registrasi berhasil! Silakan cek email Anda untuk verifikasi akun.' });
      });
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// API VERIFIKASI EMAIL
app.post('/api/verify-email', (req, res) => {
  const { token } = req.body;

  if (!token) return res.status(400).json({ message: 'Token tidak valid.' });

  // Cari user dengan token tersebut
  const query = 'SELECT id FROM users WHERE verification_token = ?';
  connection.query(query, [token], (err, results) => {
    if (err || results.length === 0) {
      return res.status(400).json({ message: 'Token verifikasi tidak valid atau sudah kedaluwarsa.' });
    }

    // Aktifkan User
    const updateQuery = 'UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?';
    connection.query(updateQuery, [results[0].id], (errUpdate) => {
      if (errUpdate) return res.status(500).json({ message: 'Gagal memverifikasi.' });
      res.status(200).json({ message: 'Email berhasil diverifikasi! Silakan login.' });
    });
  });
});

// API ENDPOINT UNTUK LOGIN (UPDATE: DENGAN CEK VERIFIKASI)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email dan password wajib diisi.' });
  }

  const query = 'SELECT * FROM users WHERE email = ?';
  connection.query(query, [email], async (error, results) => {
    if (error) return res.status(500).json({ message: 'Database error.' });

    if (results.length === 0) {
      return res.status(401).json({ message: 'Email atau password salah.' });
    }

    const user = results[0];

    try {
      // Cek Password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Email atau password salah.' });
      }

      // ============================================================
      // CEK STATUS VERIFIKASI
      // ============================================================
      if (user.is_verified === 0) {
        return res.status(403).json({ 
          message: 'Akun belum diverifikasi. Silakan cek inbox/spam email Anda untuk verifikasi.' 
        });
      }
      // ============================================================

      // Jika lolos, baru buat Token
      const payload = { 
        userId: user.id, 
        nama: user.nama_lengkap, 
        role: user.role,
        phone: user.no_telepon 
      };

      const token = jwt.sign(payload, 'RAHASIA_SUPER_AMAN', { expiresIn: '1h' }); 

      res.status(200).json({ 
        message: 'Login berhasil!',
        token: token,
        role: user.role 
      });

    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ message: 'Kesalahan server saat login.' });
    }
  });
});

// API LUPA PASSWORD (KIRIM LINK RESET)
app.post('/api/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email wajib diisi.' });

  // Cek apakah email ada
  connection.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ message: 'Email tidak terdaftar.' });
    }

    const user = results[0];
    
    // Buat Token Random
    const token = crypto.randomBytes(20).toString('hex');
    
    // Simpan token ke DB (Berlaku 1 Jam)
    const updateQuery = 'UPDATE users SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?';
    
    connection.query(updateQuery, [token, user.id], (errUpdate) => {
      if (errUpdate) return res.status(500).json({ message: 'Database error.' });

      // Kirim Email
      const resetLink = `http://localhost:5173/reset-password/${token}`; 
      
      const isiEmail = `
        <h3>Permintaan Reset Password</h3>
        <p>Halo ${user.nama_lengkap},</p>
        <p>Kami menerima permintaan untuk mereset password akun SIMASOSIAL Anda.</p>
        <p>Klik link di bawah ini untuk membuat password baru (Link berlaku 1 jam):</p>
        <a href="${resetLink}" style="background:#0d47a1;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Reset Password</a>
        <p>Jika Anda tidak meminta ini, abaikan saja email ini.</p>
      `;

      sendEmail(email, 'Reset Password - SIMASOSIAL', isiEmail);
      res.status(200).json({ message: 'Link reset password telah dikirim ke email Anda.' });
    });
  });
});

// API RESET PASSWORD (UPDATE PASSWORD BARU)
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  
  if (!token || !newPassword) return res.status(400).json({ message: 'Data tidak lengkap.' });

  // Cek Token valid dan belum expired
  const checkQuery = 'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()';
  
  connection.query(checkQuery, [token], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(400).json({ message: 'Token tidak valid atau sudah kedaluwarsa.' });
    }

    const user = results[0];

    // Hash Password Baru
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update Password & Hapus Token
    const updateQuery = 'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?';
    
    connection.query(updateQuery, [hashedPassword, user.id], (errUpdate) => {
      if (errUpdate) return res.status(500).json({ message: 'Gagal update password.' });
      res.status(200).json({ message: 'Password berhasil diubah! Silakan login.' });
    });
  });
});

// --- ROUTES: Data Publik ---

// Landing Page Activities
app.get('/api/public-activities', (req, res) => {
  const query = `SELECT id, judul, tipe, lokasi, gambar_url, target_donasi, donasi_terkumpul, target_peserta, peserta_terdaftar FROM activities WHERE status = 'published' ORDER BY created_at DESC LIMIT 3`; 
  connection.query(query, (error, results) => {
    if (error) return res.status(500).json({ message: 'Error fetching activities.' });
    res.status(200).json(results);
  });
});

// Detail Kegiatan
app.get('/api/activities/:id', (req, res) => {
  const { id } = req.params;
  connection.query('SELECT * FROM activities WHERE id = ?', [id], (error, results) => {
    if (error) return res.status(500).json({ message: 'Error database.' });
    if (results.length === 0) return res.status(404).json({ message: 'Kegiatan tidak ditemukan.' });
    res.status(200).json(results[0]);
  });
});

// Verifikasi Sertifikat
app.get('/api/verify-certificate/:kodeUnik', (req, res) => {
  const query = `SELECT cert.kode_unik, cert.tanggal_terbit, usr.nama_lengkap, usr.nim, act.judul AS nama_kegiatan, act.tanggal_mulai, act.lokasi FROM certificates AS cert JOIN users AS usr ON cert.user_id = usr.id JOIN activities AS act ON cert.activity_id = act.id WHERE cert.kode_unik = ?`;
  connection.query(query, [req.params.kodeUnik], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ message: 'Tidak valid.' });
    res.status(200).json(results[0]);
  });
});


// --- ROUTES: MAHASISWA ---

// Dashboard Data
app.get('/api/dashboard-data', verifyToken, (req, res) => {
  const userId = req.user.userId;
  const userName = req.user.nama;
  
  const queryTotalKegiatan = 'SELECT COUNT(id) AS total FROM activity_registrations WHERE user_id = ?';
  const queryTotalDonasi = 'SELECT SUM(jumlah) AS total FROM donations WHERE user_id = ? AND status_donasi = "terverifikasi"';
  const queryTotalSertifikat = 'SELECT COUNT(id) AS total FROM certificates WHERE user_id = ?';
  const queryJamKontribusi = `SELECT SUM(act.jam_kontribusi) AS total FROM activity_registrations AS reg JOIN activities AS act ON reg.activity_id = act.id WHERE reg.user_id = ? AND reg.status_kehadiran = 'hadir'`;
  const queryAktivitasBerikutnya = `SELECT act.judul, act.tanggal_mulai, act.lokasi FROM activities AS act JOIN activity_registrations AS reg ON act.id = reg.activity_id WHERE reg.user_id = ? AND reg.status_kehadiran = 'terdaftar' AND act.tanggal_mulai >= CURDATE() ORDER BY act.tanggal_mulai ASC LIMIT 1`;

  connection.query(queryTotalKegiatan, [userId], (err1, res1) => {
    if (err1) return res.status(500).json({ message: 'Error query 1' });
    connection.query(queryTotalDonasi, [userId], (err2, res2) => {
      if (err2) return res.status(500).json({ message: 'Error query 2' });
      connection.query(queryTotalSertifikat, [userId], (err3, res3) => {
        if (err3) return res.status(500).json({ message: 'Error query 3' });
        connection.query(queryJamKontribusi, [userId], (err4, res4) => {
          if (err4) return res.status(500).json({ message: 'Error query 4' });
          connection.query(queryAktivitasBerikutnya, [userId], (err5, res5) => {
            if (err5) return res.status(500).json({ message: 'Error query 5' });
            res.status(200).json({
              nama: userName, 
              totalKegiatan: res1[0].total || 0,
              jamKontribusi: res4[0].total || 0,
              totalDonasi: res2[0].total || 0,
              sertifikat: res3[0].total || 0,
              nextActivity: res5[0] || null 
            });
          });
        });
      });
    });
  });
});

// Register Volunteer
app.post('/api/activities/:id/register', verifyToken, (req, res) => {
  const userId = req.user.userId;
  const { id: activityId } = req.params;

  connection.query('SELECT tipe, peserta_terdaftar, target_peserta FROM activities WHERE id = ?', [activityId], (err, results) => {
    if (err || results.length === 0) return res.status(404).json({ message: 'Kegiatan tidak ditemukan.' });
    const activity = results[0];

    if (activity.tipe !== 'volunteer') return res.status(400).json({ message: 'Bukan kegiatan volunteer.' });
    if (activity.target_peserta > 0 && activity.peserta_terdaftar >= activity.target_peserta) return res.status(400).json({ message: 'Kuota penuh.' });

    connection.query('SELECT id FROM activity_registrations WHERE user_id = ? AND activity_id = ?', [userId, activityId], (errDup, resDup) => {
      if (resDup.length > 0) return res.status(409).json({ message: 'Sudah terdaftar.' });

      const insertQuery = 'INSERT INTO activity_registrations (user_id, activity_id, status_kehadiran) VALUES (?, ?, ?)';
      connection.query(insertQuery, [userId, activityId, 'terdaftar'], (errInsert) => {
        if (errInsert) return res.status(500).json({ message: 'Gagal mendaftar.' });
        
        connection.query('UPDATE activities SET peserta_terdaftar = peserta_terdaftar + 1 WHERE id = ?', [activityId]);
        res.status(201).json({ message: 'Berhasil terdaftar!' });
      });
    });
  });
});

// Melakukan Donasi
app.post('/api/create-transaction', verifyToken, async (req, res) => {
  const { activity_id, jumlah } = req.body;
  const orderId = `SIMA-DONASI-${uuidv4()}`;
  const parameter = {
    transaction_details: { order_id: orderId, gross_amount: parseInt(jumlah) },
    customer_details: { first_name: req.user.nama, email: req.user.email }
  };

  connection.query('INSERT INTO donations (user_id, activity_id, jumlah, status_donasi, order_id) VALUES (?, ?, ?, ?, ?)', [req.user.userId, activity_id, jumlah, 'pending', orderId], async (err) => {
    if (err) return res.status(500).json({ message: 'DB Error' });
    try {
      const transaction = await snap.createTransaction(parameter);
      res.status(201).json({ token: transaction.token });
    } catch (e) { res.status(500).json({ message: 'Midtrans Error' }); }
  });
});

// Sertifikat Saya
app.get('/api/my-certificates', verifyToken, (req, res) => {
  const query = `SELECT cert.id, cert.kode_unik, cert.tanggal_terbit, act.judul AS nama_kegiatan, act.tipe FROM certificates AS cert JOIN activities AS act ON cert.activity_id = act.id WHERE cert.user_id = ? ORDER BY cert.tanggal_terbit DESC`;
  connection.query(query, [req.user.userId], (err, results) => res.status(200).json(results));
});

// My Activities (List)
app.get('/api/my-activities', verifyToken, (req, res) => {
  const query = `SELECT act.id, act.judul, act.tipe, act.tanggal_mulai FROM activities AS act JOIN activity_registrations AS reg ON act.id = reg.activity_id WHERE reg.user_id = ? ORDER BY act.tanggal_mulai DESC LIMIT 5`;
  connection.query(query, [req.user.userId], (error, results) => {
    if (error) return res.status(500).json({ message: 'Error database.' });
    res.status(200).json(results);
  });
});

// Notifikasi
app.get('/api/my-notifications', verifyToken, (req, res) => {
  const query = `SELECT id, pesan, link_url, status_baca, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`;
  connection.query(query, [req.user.userId], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error DB' });
    const unread = results.filter(n => n.status_baca === 'belum_dibaca').length;
    res.status(200).json({ notifications: results, unreadCount: unread });
  });
});

app.put('/api/notifications/mark-read', verifyToken, (req, res) => {
  connection.query('UPDATE notifications SET status_baca = "sudah_dibaca" WHERE user_id = ?', [req.user.userId], () => {
    res.status(200).json({ message: 'Dibaca.' });
  });
});


// --- ROUTES: ADMIN ---

// Get Activities
app.get('/api/admin/activities', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  connection.query('SELECT * FROM activities ORDER BY created_at DESC', (error, results) => {
    if (error) return res.status(500).json({ message: 'Error database.' });
    res.status(200).json(results);
  });
});

// Membuat Aktivitas
app.post('/api/admin/activities', verifyToken, upload.single('gambar'), (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  const { judul, tipe, deskripsi, lokasi, tanggal_mulai, target_donasi, target_peserta, jam_kontribusi } = req.body;
  const gambar_url = req.file ? req.file.path.replace(/\\/g, "/") : null;

  const query = `INSERT INTO activities (judul, tipe, deskripsi, lokasi, tanggal_mulai, target_donasi, target_peserta, jam_kontribusi, status, gambar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)`;
  const values = [judul, tipe, deskripsi, lokasi, tanggal_mulai, target_donasi || 0, target_peserta || 0, jam_kontribusi || 0, gambar_url];

  connection.query(query, values, (error, results) => {
    if (error) return res.status(500).json({ message: 'Gagal menyimpan.' });
    res.status(201).json({ message: 'Kegiatan ditambahkan!', insertedId: results.insertId });
  });
});

// API UNTUK ADMIN - UPDATE KEGIATAN
app.put('/api/admin/activities/:id', verifyToken, upload.single('gambar'), (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  const { id } = req.params;
  const { 
    judul, tipe, deskripsi, lokasi, tanggal_mulai, 
    target_donasi, target_peserta, jam_kontribusi, 
    status // AMBIL STATUS DARI FORM
  } = req.body;

  const gambar_url = req.file ? req.file.path.replace(/\\/g, "/") : null;

  // UPDATE QUERY SQL UNTUK MENYIMPAN STATUS
  let query = `
    UPDATE activities SET 
    judul = ?, tipe = ?, deskripsi = ?, lokasi = ?, tanggal_mulai = ?, 
    target_donasi = ?, target_peserta = ?, jam_kontribusi = ?, status = ? 
    ${gambar_url ? ', gambar_url = ?' : ''} 
    WHERE id = ?
  `;
  
  let values = [
    judul, tipe, deskripsi, lokasi, tanggal_mulai, 
    target_donasi || 0, target_peserta || 0, jam_kontribusi || 0, 
    status || 'published' // <-- SIMPAN STATUS
  ];

  if (gambar_url) values.push(gambar_url);
  values.push(id);

  connection.query(query, values, (error, results) => {
    if (error) return res.status(500).json({ message: 'Gagal update.' });
    res.status(200).json({ message: 'Kegiatan diupdate!' });
  });
});

// Menghapus Kegiatan
app.delete('/api/admin/activities/:id', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  const { id } = req.params;

  connection.query('DELETE FROM activity_registrations WHERE activity_id = ?', [id], () => {
    connection.query('DELETE FROM donations WHERE activity_id = ?', [id], () => {
      connection.query('SELECT gambar_url FROM activities WHERE id = ?', [id], (err, results) => {
        if (results.length > 0 && results[0].gambar_url) fs.unlink(results[0].gambar_url, () => {});
        connection.query('DELETE FROM activities WHERE id = ?', [id], (err, result) => {
          if (err) return res.status(500).json({ message: 'Gagal hapus.' });
          res.status(200).json({ message: 'Kegiatan dihapus!' });
        });
      });
    });
  });
});

// Get Participants
app.get('/api/admin/activities/:id/participants', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  const query = `SELECT reg.id AS registration_id, reg.status_kehadiran, usr.nama_lengkap, usr.nim, usr.email FROM activity_registrations AS reg JOIN users AS usr ON reg.user_id = usr.id WHERE reg.activity_id = ?`;
  connection.query(query, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ message: 'Error database.' });
    res.status(200).json(results);
  });
});

// Update Attendance
app.put('/api/admin/participants/:registration_id/status', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  connection.query('UPDATE activity_registrations SET status_kehadiran = ? WHERE id = ?', [req.body.newStatus, req.params.registration_id], (err) => {
    if (err) return res.status(500).json({ message: 'Error database.' });
    res.status(200).json({ message: 'Status diupdate!' });
  });
});

// API UNTUK ADMIN - TERBITKAN SERTIFIKAT (DENGAN EMAIL & NOTIFIKASI)
app.post('/api/admin/activities/:id/generate-certificates', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  const { id: activityId } = req.params;

  // JOIN ke tabel 'users' untuk ambil email & nama
  const findHadirQuery = `
    SELECT reg.user_id, usr.email, usr.nama_lengkap
    FROM activity_registrations AS reg
    LEFT JOIN certificates AS cert ON reg.user_id = cert.user_id AND reg.activity_id = cert.activity_id
    JOIN users AS usr ON reg.user_id = usr.id  -- Join tabel users
    WHERE reg.activity_id = ? 
      AND reg.status_kehadiran = 'hadir' 
      AND cert.id IS NULL
  `;

  connection.query(findHadirQuery, [activityId], (err, usersToCertify) => {
    if (err) return res.status(500).json({ message: 'Error database.' });
    if (usersToCertify.length === 0) return res.status(404).json({ message: 'Tidak ada peserta baru untuk diterbitkan.' });

    // Siapkan data insert sertifikat
    const valuesToInsert = usersToCertify.map(user => [user.user_id, activityId, uuidv4()]);
    
    connection.query('INSERT INTO certificates (user_id, activity_id, kode_unik) VALUES ?', [valuesToInsert], (errInsert, results) => {
      if (errInsert) return res.status(500).json({ message: 'Gagal terbit.' });

      // Ambil Judul Kegiatan untuk Pesan Notifikasi
      connection.query('SELECT judul FROM activities WHERE id = ?', [activityId], (errAct, resAct) => {
        const judul = resAct[0].judul;
        
        // BUAT NOTIFIKASI LONCENG (DATABASE)
        const notifValues = usersToCertify.map(u => [u.user_id, `Sertifikat untuk "${judul}" telah terbit.`, '/sertifikat-saya']);
        connection.query('INSERT INTO notifications (user_id, pesan, link_url) VALUES ?', [notifValues]);

        // ============================================================
        // KIRIM EMAIL PEMBERITAHUAN 
        // ============================================================
        usersToCertify.forEach(user => {
           const isiEmail = `
             <h3>Selamat, ${user.nama_lengkap}!</h3>
             <p>Sertifikat Anda untuk kegiatan <b>"${judul}"</b> telah resmi diterbitkan.</p>
             <p>Anda dapat mengunduhnya sekarang melalui menu "Sertifikat Saya" di dashboard aplikasi.</p>
             <br/>
             <p>Terima kasih atas partisipasi Anda,<br/>Admin SIMASOSIAL FST</p>
           `;
           
           // Panggil fungsi helper sendEmail
           sendEmail(user.email, 'Sertifikat Terbit - SIMASOSIAL', isiEmail);
        });
        // ============================================================
      });

      res.status(201).json({ message: `Berhasil! ${results.affectedRows} sertifikat diterbitkan.` });
    });
  });
});

// Get Users
app.get('/api/admin/users', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  connection.query('SELECT id, nama_lengkap, nim, jurusan, angkatan, no_telepon, email, role FROM users ORDER BY created_at DESC', (err, results) => {
    if (err) return res.status(500).json({ message: 'Error database.' });
    res.status(200).json(results);
  });
});

// EXPORT DATA PENGGUNA KE EXCEL (XLSX)
app.get('/api/admin/users/export-excel', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });

  const query = 'SELECT * FROM users ORDER BY nama_lengkap ASC';

  connection.query(query, async (error, results) => {
    if (error) return res.status(500).json({ message: 'Database error.' });
    
    try {
      // Buat Workbook & Worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Data Mahasiswa');

      // Atur Header Kolom
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Nama Lengkap', key: 'nama_lengkap', width: 30 },
        { header: 'NIM', key: 'nim', width: 15 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'No. HP', key: 'no_telepon', width: 15 },
        { header: 'Jurusan', key: 'jurusan', width: 20 },
        { header: 'Angkatan', key: 'angkatan', width: 10 },
        { header: 'Role', key: 'role', width: 10 },
        { header: 'Status Verifikasi', key: 'is_verified', width: 15 },
      ];

      // Masukkan Data
      results.forEach(user => {
        worksheet.addRow({
          id: user.id,
          nama_lengkap: user.nama_lengkap,
          nim: user.nim,
          email: user.email,
          no_telepon: user.no_telepon,
          jurusan: user.jurusan,
          angkatan: user.angkatan,
          role: user.role,
          is_verified: user.is_verified ? 'Sudah' : 'Belum'
        });
      });

      // Percantik Header (Bold)
      worksheet.getRow(1).font = { bold: true };

      // Kirim File
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=' + 'Data_Pengguna_SIMASOSIAL.xlsx');

      await workbook.xlsx.write(res);
      res.end();

    } catch (err) {
      console.error('Excel Error:', err);
      res.status(500).json({ message: 'Gagal membuat file Excel.' });
    }
  });
});

// Update Role
app.put('/api/admin/users/:id/role', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  if (parseInt(req.params.id) === req.user.userId) return res.status(403).json({ message: 'Tidak bisa ubah diri sendiri.' });
  connection.query('UPDATE users SET role = ? WHERE id = ?', [req.body.newRole, req.params.id], (err) => {
    if (err) return res.status(500).json({ message: 'Error database.' });
    res.status(200).json({ message: 'Role diupdate.' });
  });
});

// Admin Profile
app.get('/api/admin/profile', verifyToken, (req, res) => {
  connection.query('SELECT id, nama_lengkap, email, no_telepon FROM users WHERE id = ?', [req.user.userId], (err, r) => {
    res.json(r[0]);
  });
});

app.put('/api/admin/profile', verifyToken, async (req, res) => {
  const { nama_lengkap, email, no_telepon, password_baru } = req.body;
  let query, values;
  if (password_baru) {
    const hash = await bcrypt.hash(password_baru, 10);
    query = 'UPDATE users SET nama_lengkap=?, email=?, no_telepon=?, password=? WHERE id=?';
    values = [nama_lengkap, email, no_telepon, hash, req.user.userId];
  } else {
    query = 'UPDATE users SET nama_lengkap=?, email=?, no_telepon=? WHERE id=?';
    values = [nama_lengkap, email, no_telepon, req.user.userId];
  }
  connection.query(query, values, (err) => {
    if (err) return res.status(500).json({ message: 'Gagal update.' });
    res.status(200).json({ message: 'Profil diupdate.' });
  });
});

// Export Peserta ke EXCEL 
app.get('/api/admin/activities/:id/export-participants-excel', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });
  const { id: activityId } = req.params;

  const query = `
    SELECT usr.nama_lengkap, usr.nim, usr.email, usr.no_telepon, usr.jurusan, usr.angkatan, reg.status_kehadiran
    FROM activity_registrations AS reg
    JOIN users AS usr ON reg.user_id = usr.id
    WHERE reg.activity_id = ? ORDER BY usr.nama_lengkap
  `;

  connection.query(query, [activityId], async (error, results) => {
    if (error) return res.status(500).json({ message: 'Database error.' });
    if (results.length === 0) return res.status(404).json({ message: 'Tidak ada peserta.' });

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Daftar Peserta');

      worksheet.columns = [
        { header: 'Nama Lengkap', key: 'nama_lengkap', width: 30 },
        { header: 'NIM', key: 'nim', width: 15 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'No. HP', key: 'no_telepon', width: 15 },
        { header: 'Jurusan', key: 'jurusan', width: 20 },
        { header: 'Angkatan', key: 'angkatan', width: 10 },
        { header: 'Status', key: 'status_kehadiran', width: 15 },
      ];

      worksheet.addRows(results);
      worksheet.getRow(1).font = { bold: true };

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=Peserta_Kegiatan_${activityId}.xlsx`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Gagal export Excel.' });
    }
  });
});

// API UNTUK ADMIN - EXPORT KEGIATAN KE EXCEL (XLSX)
app.get('/api/admin/activities/export-excel', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });

  const query = 'SELECT * FROM activities ORDER BY created_at DESC';

  connection.query(query, async (error, results) => {
    if (error) return res.status(500).json({ message: 'Database error.' });
    
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Laporan Kegiatan');

      // Definisi Kolom Header
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 5 },
        { header: 'Judul Kegiatan', key: 'judul', width: 30 },
        { header: 'Tipe', key: 'tipe', width: 10 },
        { header: 'Lokasi', key: 'lokasi', width: 20 },
        { header: 'Tanggal', key: 'tanggal_mulai', width: 15 },
        { header: 'Target Dana', key: 'target_donasi', width: 15 },
        { header: 'Terkumpul', key: 'donasi_terkumpul', width: 15 },
        { header: 'Target Peserta', key: 'target_peserta', width: 15 },
        { header: 'Pendaftar', key: 'peserta_terdaftar', width: 10 },
        { header: 'Status', key: 'status', width: 10 },
      ];

      // Masukkan Data
      results.forEach(act => {
        worksheet.addRow({
          id: act.id,
          judul: act.judul,
          tipe: act.tipe,
          lokasi: act.lokasi,
          tanggal_mulai: act.tanggal_mulai ? new Date(act.tanggal_mulai).toLocaleDateString('id-ID') : '-',
          target_donasi: act.target_donasi,
          donasi_terkumpul: act.donasi_terkumpul,
          target_peserta: act.target_peserta,
          peserta_terdaftar: act.peserta_terdaftar,
          status: act.status
        });
      });

      // Styling Header
      worksheet.getRow(1).font = { bold: true };

      // Kirim File
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=' + 'Laporan_Kegiatan.xlsx');

      await workbook.xlsx.write(res);
      res.end();

    } catch (err) {
      console.error('Excel Error:', err);
      res.status(500).json({ message: 'Gagal membuat file Excel.' });
    }
  });
});

// --- SYSTEM ---

// Midtrans Webhook
app.post('/api/midtrans-webhook', async (req, res) => {
  try {
    const notificationJson = req.body;
    
    const grossAmount = notificationJson.gross_amount.endsWith('.00') 
                          ? notificationJson.gross_amount 
                          : `${notificationJson.gross_amount}.00`;

    const signatureKey = notificationJson.order_id + notificationJson.status_code + grossAmount + process.env.MIDTRANS_SERVER_KEY;
    
    const shasum = crypto.createHash('sha512');
    shasum.update(signatureKey);
    const hashedSignatureKey = shasum.digest('hex');

    // Validasi Signature
    if (notificationJson.signature_key === hashedSignatureKey) {
      const orderId = notificationJson.order_id;
      const transactionStatus = notificationJson.transaction_status;
      const fraudStatus = notificationJson.fraud_status;

      if (transactionStatus === 'settlement') {
        if (fraudStatus === 'accept') {
          console.log(`STATUS: Settlement. Mengupdate database untuk ${orderId}...`);
          
          // Update status donasi di database jadi 'terverifikasi'
          const updateDonationQuery = 'UPDATE donations SET status_donasi = "terverifikasi" WHERE order_id = ? AND status_donasi = "pending"';
          
          connection.query(updateDonationQuery, [orderId], (err, updateResult) => {
            // Pastikan update berhasil (agar tidak kirim email double)
            if (updateResult && updateResult.affectedRows > 0) {
              
              // Ambil data detail donasi (siapa usernya, berapa jumlahnya)
              connection.query('SELECT user_id, jumlah, activity_id FROM donations WHERE order_id = ?', [orderId], (err, results) => {
                if (results && results.length > 0) {
                  const { user_id, jumlah, activity_id } = results[0];
                  
                  // Update total donasi di tabel activities
                  const updateActivityQuery = 'UPDATE activities SET donasi_terkumpul = donasi_terkumpul + ? WHERE id = ?';
                  connection.query(updateActivityQuery, [jumlah, activity_id]);

                  // Buat Notifikasi Lonceng (Database)
                  const pesan = `Donasi Anda sebesar ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(jumlah)} telah terverifikasi.`;
                  const link = `/kegiatan/${activity_id}`;
                  const queryNotif = 'INSERT INTO notifications (user_id, pesan, link_url) VALUES (?, ?, ?)';
                  connection.query(queryNotif, [user_id, pesan, link]);

                  // ============================================================
                  // KIRIM EMAIL TERIMA KASIH 
                  // ============================================================
                  connection.query('SELECT email, nama_lengkap FROM users WHERE id = ?', [user_id], (errUser, resUser) => {
                    if (resUser.length > 0) {
                       const userEmail = resUser[0].email;
                       const userName = resUser[0].nama_lengkap;
                       
                       const isiEmail = `
                        <h3>Terima Kasih, ${userName}!</h3>
                        <p>Donasi Anda sebesar <b>Rp ${new Intl.NumberFormat('id-ID').format(jumlah)}</b> telah kami terima dan terverifikasi oleh sistem.</p>
                        <p>Kontribusi Anda sangat berarti bagi kegiatan sosial kami.</p>
                        <br/>
                        <p>Salam,<br/>Admin SIMASOSIAL FST</p>
                       `;
                       
                       // Panggil fungsi sendEmail
                       sendEmail(userEmail, 'Donasi Berhasil Terverifikasi - SIMASOSIAL', isiEmail);
                    }
                  });
                  // ============================================================

                }
              });
            }
          });
        }
      } else if (transactionStatus === 'cancel' || transactionStatus === 'expire') {
        const updateQuery = 'UPDATE donations SET status_donasi = "gagal" WHERE order_id = ?';
        connection.query(updateQuery, [orderId]);
      }
      
      res.status(200).json({ message: 'Webhook processed successfully.' });

    } else {
      res.status(403).json({ message: 'Invalid signature.' });
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// API UMUM - GET PROFIL SAYA (BISA MAHASISWA/ADMIN)
app.get('/api/profile', verifyToken, (req, res) => {
  const userId = req.user.userId;
  // Ambil data user
  const query = 'SELECT id, nama_lengkap, nim, email, no_telepon, jurusan, angkatan, role FROM users WHERE id = ?';

  connection.query(query, [userId], (error, results) => {
    if (error) return res.status(500).json({ message: 'Kesalahan server.' });
    if (results.length === 0) return res.status(404).json({ message: 'User tidak ditemukan.' });
    res.status(200).json(results[0]);
  });
});

// API UMUM - UPDATE PROFIL SAYA
app.put('/api/profile', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { nama_lengkap, email, no_telepon, password_baru } = req.body;

  if (!nama_lengkap || !email) {
    return res.status(400).json({ message: 'Nama dan Email wajib diisi.' });
  }

  let query, values;

  try {
    if (password_baru) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password_baru, salt);
      
      query = 'UPDATE users SET nama_lengkap = ?, email = ?, no_telepon = ?, password = ? WHERE id = ?';
      values = [nama_lengkap, email, no_telepon || null, hashedPassword, userId];
    } else {
      query = 'UPDATE users SET nama_lengkap = ?, email = ?, no_telepon = ? WHERE id = ?';
      values = [nama_lengkap, email, no_telepon || null, userId];
    }

    connection.query(query, values, (error, results) => {
      if (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email sudah digunakan.' });
        return res.status(500).json({ message: 'Gagal mengupdate profil.' });
      }
      res.status(200).json({ message: 'Profil berhasil diperbarui!' });
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// API UNTUK DASHBOARD ADMIN (STATISTIK LENGKAP)
app.get('/api/admin/dashboard-stats', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });

  const queryTotalKegiatan = "SELECT COUNT(*) AS total FROM activities WHERE status = 'published'";
  const queryTotalUser = "SELECT COUNT(*) AS total FROM users WHERE role = 'mahasiswa'";
  const queryDonasiPending = "SELECT COUNT(*) AS total FROM donations WHERE status_donasi = 'pending'";
  const queryTotalDonasiTerkumpul = "SELECT SUM(jumlah) AS total FROM donations WHERE status_donasi = 'terverifikasi'";
  
  // Query untuk mengambil 5 donasi terbaru
  const queryDonasiTerbaru = `
    SELECT d.id, u.nama_lengkap, d.jumlah, d.status_donasi, d.tanggal_donasi, a.judul as nama_kegiatan
    FROM donations d
    JOIN users u ON d.user_id = u.id
    JOIN activities a ON d.activity_id = a.id
    ORDER BY d.tanggal_donasi DESC
    LIMIT 5
  `;

  connection.query(queryTotalKegiatan, (err1, res1) => {
    if (err1) return res.status(500).json({ message: 'Error query 1' });
    
    connection.query(queryTotalUser, (err2, res2) => {
      if (err2) return res.status(500).json({ message: 'Error query 2' });
      
      connection.query(queryDonasiPending, (err3, res3) => {
        if (err3) return res.status(500).json({ message: 'Error query 3' });
        
        connection.query(queryTotalDonasiTerkumpul, (err4, res4) => {
           if (err4) return res.status(500).json({ message: 'Error query 4' });

           connection.query(queryDonasiTerbaru, (err5, res5) => {
             if (err5) return res.status(500).json({ message: 'Error query 5' });

             res.json({
               totalKegiatan: res1[0].total || 0,
               totalUser: res2[0].total || 0,
               donasiPending: res3[0].total || 0,
               totalUangDonasi: res4[0].total || 0,
               donasiTerbaru: res5
             });
           });
        });
      });
    });
  });
});

// API UNTUK ADMIN - TEST KIRIM EMAIL
app.post('/api/admin/email/test', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Akses ditolak.' });

  // Ambil email admin yang sedang login dari token/database
  const adminId = req.user.userId;
  
  connection.query('SELECT email, nama_lengkap FROM users WHERE id = ?', [adminId], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ message: 'Gagal mengambil data admin.' });
    
    const adminEmail = results[0].email;
    const adminName = results[0].nama_lengkap;

    const subject = 'Test Konfigurasi Email - SIMASOSIAL';
    const htmlContent = `
      <h3>Halo, ${adminName}!</h3>
      <p>Ini adalah email percobaan dari sistem SIMASOSIAL.</p>
      <p>Jika Anda menerima email ini, berarti <b>konfigurasi Nodemailer Anda SUKSES!</b> 🎉</p>
    `;

    // Panggil fungsi sendEmail yang sudah dibuat
    try {
      sendEmail(adminEmail, subject, htmlContent);
      res.status(200).json({ message: `Email tes berhasil dikirim ke ${adminEmail}` });
    } catch (error) {
      res.status(500).json({ message: 'Gagal mengirim email. Cek terminal backend.' });
    }
  });
});

// API PUBLIK - AMBIL SEMUA KEGIATAN (UNTUK HALAMAN KATALOG)
app.get('/api/all-activities', (req, res) => {
  const query = `
    SELECT id, judul, tipe, lokasi, gambar_url, tanggal_mulai,
           target_donasi, donasi_terkumpul, 
           target_peserta, peserta_terdaftar 
    FROM activities 
    WHERE status = 'published' 
    ORDER BY created_at DESC
  `; 
  
  connection.query(query, (error, results) => {
    if (error) {
      console.error('Error fetching all activities:', error);
      return res.status(500).json({ message: 'Kesalahan server.' });
    }
    res.status(200).json(results);
  });
});

app.listen(port, () => {
  console.log(`Server backend berjalan di http://localhost:${port}`);
});