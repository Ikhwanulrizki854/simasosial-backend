// 1. Impor paket-paket
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const verifyToken = require('./middleware/verifyToken');
const multer = require('multer'); 
const path = require('path'); 

// 2. Inisialisasi aplikasi express
const app = express();
const port = 8000; 

// 3. BUAT FOLDER UPLOADS MENJADI PUBLIK
// Ini agar frontend bisa mengakses gambar: http://localhost:8000/uploads/nama-gambar.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 3. KONFIGURASI MULTER (Penyimpanan File)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Simpan di folder 'uploads/'
  },
  filename: (req, file, cb) => {
    // Buat nama file yang unik: timestamp + nama asli
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// 3. Gunakan middleware
app.use(cors()); // Mengizinkan koneksi dari frontend (React)
app.use(express.json()); // Mengizinkan server membaca data JSON

// 4. Hubungkan ke Database MySQL
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '', // Sesuaikan dengan password XAMPP Anda
  database: 'simasosial_db' // Pastikan namanya sama
});

// Tes koneksi
connection.connect(error => {
  if (error) {
    console.error('Error connecting to database:', error);
    return;
  }
  console.log('Successfully connected to database (simasosial_db)!');
});


// 5. API Endpoint tes
app.get('/', (req, res) => {
  res.json({ message: "Halo! Ini adalah backend SIMASOSIAL FST." });
});

// 6. API Endpoint untuk tes user (bisa dihapus nanti)
app.get('/api/users', (req, res) => {
  connection.query('SELECT * FROM users', (error, results) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.json(results);
  });
});

// 7. API ENDPOINT UNTUK REGISTRASI (POST)
app.post('/api/register', async (req, res) => {
  const { nama, nim, jurusan, telepon, email, password } = req.body;

  if (!nama || !nim || !email || !password) {
    return res.status(400).json({ message: 'Email, password, nama, dan NIM wajib diisi.' });
  }

  // Logika untuk "memotong" NIM (misal: "22" -> "2022")
  let angkatan = null;
  if (nim && nim.length >= 2) {
    angkatan = "20" + nim.substring(0, 2); 
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const query = 'INSERT INTO users (nama_lengkap, nim, jurusan, angkatan, no_telepon, email, password) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const values = [nama, nim, jurusan, angkatan, telepon, email, hashedPassword];

    connection.query(query, values, (error, results) => {
      if (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'Email atau NIM sudah terdaftar.' });
        }
        console.error('Error inserting data:', error);
        return res.status(500).json({ message: 'Gagal mendaftar, terjadi kesalahan server.' });
      }
      res.status(201).json({ message: 'Registrasi berhasil!' });
    });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  }
});

// 8. API ENDPOINT UNTUK LOGIN (POST)
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email dan password wajib diisi.' });
  }

  const query = 'SELECT * FROM users WHERE email = ?';
  connection.query(query, [email], async (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Kesalahan server database.' });
    }

    if (results.length === 0) {
      return res.status(401).json({ message: 'Email atau password salah.' });
    }

    const user = results[0];

    try {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Email atau password salah.' });
      }

      const payload = {
        userId: user.id,
        nama: user.nama_lengkap,
        role: user.role
      };

      // Ganti 'RAHASIA_SUPER_AMAN' ini dengan string acak Anda sendiri
      const token = jwt.sign(payload, 'RAHASIA_SUPER_AMAN', { expiresIn: '1h' }); 

      res.status(200).json({ 
        message: 'Login berhasil!',
        token: token,
        role: user.role // Kirim role ke frontend
      });

    } catch (err) {
      console.error('Bcrypt error:', err);
      res.status(500).json({ message: 'Kesalahan server saat login.' });
    }
  });
});

// 9. API ENDPOINT UNTUK DATA DASHBOARD (AMAN)
app.get('/api/dashboard-data', verifyToken, (req, res) => {
  const userId = req.user.userId;
  const userName = req.user.nama;
  
  // (Nanti, query ini harus diganti dengan data asli dari tabel donasi/registrasi)
  const data = {
    nama: userName, 
    totalKegiatan: 12, // (Masih statis)
    jamKontribusi: 96,  // (Masih statis)
    totalDonasi: 500000, // (Masih statis)
    sertifikat: 3,        // (Masih statis)
  };
  
  res.status(200).json(data);
});

// 10. API ENDPOINT UNTUK "KEGIATAN TERDAFTAR" (AMAN)
app.get('/api/my-activities', verifyToken, (req, res) => {
  const userId = req.user.userId;

  const query = `
    SELECT 
      act.id, 
      act.judul, 
      act.tipe, 
      act.tanggal_mulai 
    FROM activities AS act
    JOIN activity_registrations AS reg ON act.id = reg.activity_id
    WHERE reg.user_id = ?
    ORDER BY act.tanggal_mulai DESC
    LIMIT 5; 
  `;

  connection.query(query, [userId], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Kesalahan server database.' });
    }
    res.status(200).json(results);
  });
});

// 11. API ENDPOINT UNTUK DETAIL KEGIATAN (PUBLIK)
app.get('/api/activities/:id', (req, res) => {
  const { id } = req.params;
  const query = 'SELECT * FROM activities WHERE id = ?';

  connection.query(query, [id], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Kesalahan server database.' });
    }
    if (results.length === 0) {
      return res.status(404).json({ message: 'Kegiatan tidak ditemukan.' });
    }
    res.status(200).json(results[0]);
  });
});

// 11. BUAT API ENDPOINT UNTUK ADMIN - AMBIL SEMUA KEGIATAN (AMAN)
app.get('/api/admin/activities', verifyToken, (req, res) => {
  // Cek jika rolenya bukan admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak. Hanya untuk admin.' });
  }

  const query = 'SELECT * FROM activities ORDER BY created_at DESC';

  connection.query(query, (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Kesalahan server database.' });
    }
    res.status(200).json(results);
  });
});

// 12. UBAH API ENDPOINT "CREATE ACTIVITY"
// Kita ganti 'app.post(...)' menjadi 'upload.single('gambar')'
// Ini berarti: "Endpoint ini sekarang menerima 1 file dari field bernama 'gambar'"
app.post('/api/admin/activities', verifyToken, upload.single('gambar'), (req, res) => {
  // Cek jika rolenya bukan admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak. Hanya untuk admin.' });
  }

  // Data teks sekarang ada di 'req.body'
  const { 
    judul, tipe, deskripsi, lokasi, tanggal_mulai, target_donasi, target_peserta 
  } = req.body;
  
  // Data file (gambar) ada di 'req.file'
  // Kita simpan path-nya, misal: "uploads/12345-gambar.jpg"
  // Kita ganti backslash (Windows) jadi slash (URL)
  const gambar_url = req.file ? req.file.path.replace(/\\/g, "/") : null;

  // Validasi dasar
  if (!judul || !tipe || !tanggal_mulai) {
    return res.status(400).json({ message: 'Judul, Tipe, dan Tanggal Mulai wajib diisi.' });
  }

  const query = `
    INSERT INTO activities 
    (judul, tipe, deskripsi, lokasi, tanggal_mulai, target_donasi, target_peserta, status, gambar_url) 
    VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)
  `;
  
  const values = [
    judul, tipe, deskripsi || null, lokasi || null, tanggal_mulai,
    tipe === 'donasi' ? (target_donasi || 0) : 0,
    tipe === 'volunteer' ? (target_peserta || 0) : 0,
    gambar_url // <-- Simpan path gambar ke DB
  ];

  connection.query(query, values, (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Gagal menyimpan kegiatan ke database.' });
    }
    res.status(201).json({ message: 'Kegiatan berhasil ditambahkan!', insertedId: results.insertId });
  });
});

// 13. BUAT API ENDPOINT UNTUK ADMIN - UPDATE KEGIATAN (AMAN)
// Kita pakai 'upload.single' lagi untuk menangani gambar baru
app.put('/api/admin/activities/:id', verifyToken, upload.single('gambar'), (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak.' });
  }

  const { id } = req.params;
  const { 
    judul, tipe, deskripsi, lokasi, tanggal_mulai, target_donasi, target_peserta 
  } = req.body;

  // Cek jika ada file baru yang diupload
  const gambar_url = req.file ? req.file.path.replace(/\\/g, "/") : null;

  // Query update-nya sedikit lebih kompleks
  // Kita hanya update gambar_url JIKA ada gambar baru
  let query = `
    UPDATE activities SET 
    judul = ?, tipe = ?, deskripsi = ?, lokasi = ?, tanggal_mulai = ?, 
    target_donasi = ?, target_peserta = ?
    ${gambar_url ? ', gambar_url = ?' : ''} 
    WHERE id = ?
  `;
  
  const values = [
    judul, tipe, deskripsi || null, lokasi || null, tanggal_mulai,
    tipe === 'donasi' ? (target_donasi || 0) : 0,
    tipe === 'volunteer' ? (target_peserta || 0) : 0
  ];

  if (gambar_url) {
    values.push(gambar_url); // Tambahkan gambar baru ke query
  }
  values.push(id); // Tambahkan ID di akhir untuk 'WHERE id = ?'

  connection.query(query, values, (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Gagal mengupdate kegiatan.' });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'Kegiatan tidak ditemukan.' });
    }
    res.status(200).json({ message: 'Kegiatan berhasil diupdate!' });
  });
});

// 13. Menjalankan server
app.listen(port, () => {
  console.log(`Server backend berjalan di http://localhost:${port}`);
});