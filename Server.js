// 1. Impor paket-paket
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const verifyToken = require('./middleware/verifyToken');
const multer = require('multer'); 
const path = require('path'); 
const fs = require('fs');

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

// 12. BUAT API ENDPOINT UNTUK ADMIN - AMBIL SEMUA KEGIATAN (AMAN)
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

// 13. UBAH API ENDPOINT "CREATE ACTIVITY"
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

// 14. BUAT API ENDPOINT UNTUK ADMIN - UPDATE KEGIATAN (AMAN)
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

// 15. BUAT API ENDPOINT UNTUK ADMIN - DELETE KEGIATAN (AMAN)
app.delete('/api/admin/activities/:id', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak.' });
  }

  const { id } = req.params;

  // SEBELUM MENGHAPUS KEGIATAN, kita harus menghapus data terkait
  // 1. Hapus pendaftaran (registrations) terkait
  connection.query('DELETE FROM activity_registrations WHERE activity_id = ?', [id], (errReg) => {
    if (errReg) {
      console.error('Error deleting registrations:', errReg);
      return res.status(500).json({ message: 'Gagal menghapus data terkait.' });
    }

    // 2. Hapus donasi (donations) terkait
    connection.query('DELETE FROM donations WHERE activity_id = ?', [id], (errDon) => {
      if (errDon) {
        console.error('Error deleting donations:', errDon);
        return res.status(500).json({ message: 'Gagal menghapus data terkait.' });
      }

      // 3. Ambil nama file gambar sebelum menghapus kegiatan
      connection.query('SELECT gambar_url FROM activities WHERE id = ?', [id], (errSel, results) => {
        if (errSel || results.length === 0) {
          return res.status(404).json({ message: 'Kegiatan tidak ditemukan.' });
        }
        
        const gambarUrl = results[0].gambar_url;

        // 4. Baru hapus kegiatan utamanya
        connection.query('DELETE FROM activities WHERE id = ?', [id], (errAct, resultAct) => {
          if (errAct) {
            console.error('Error deleting activity:', errAct);
            return res.status(500).json({ message: 'Gagal menghapus kegiatan.' });
          }

          // 5. Jika kegiatan berhasil dihapus DAN ada gambar, hapus file gambarnya
          if (gambarUrl) {
            fs.unlink(gambarUrl, (errFile) => {
              if (errFile) {
                console.error('Gagal menghapus file gambar:', errFile);
                // Jangan kirim error, lanjutkan saja. DB sudah bersih.
              }
              console.log('File gambar berhasil dihapus:', gambarUrl);
            });
          }
          
          res.status(200).json({ message: 'Kegiatan berhasil dihapus!' });
        });
      });
    });
  });
});

// 16. BUAT API ENDPOINT UNTUK ADMIN - AMBIL SEMUA PENGGUNA (AMAN)
app.get('/api/admin/users', verifyToken, (req, res) => {
  // Cek jika rolenya bukan admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak. Hanya untuk admin.' });
  }

  // Ambil semua data KECUALI password
  const query = 'SELECT id, nama_lengkap, nim, jurusan, angkatan, no_telepon, email, role FROM users ORDER BY created_at DESC';

  connection.query(query, (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Kesalahan server database.' });
    }
    res.status(200).json(results);
  });
});

// 17. BUAT API ENDPOINT UNTUK ADMIN - UPDATE ROLE PENGGUNA (AMAN)
app.put('/api/admin/users/:id/role', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak.' });
  }

  const { id } = req.params;
  const { newRole } = req.body; // Data role baru dikirim dari frontend

  if (!newRole || (newRole !== 'admin' && newRole !== 'mahasiswa')) {
    return res.status(400).json({ message: 'Role tidak valid.' });
  }

  // Admin tidak bisa mengubah role-nya sendiri
  if (parseInt(id, 10) === req.user.userId) {
     return res.status(403).json({ message: 'Anda tidak dapat mengubah role akun Anda sendiri.' });
  }

  const query = 'UPDATE users SET role = ? WHERE id = ?';
  
  connection.query(query, [newRole, id], (error, results) => {
    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ message: 'Gagal mengupdate role.' });
    }
    if (results.affectedRows === 0) {
      return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });
    }
    res.status(200).json({ message: 'Role pengguna berhasil diupdate!' });
  });
});

// 18. API UNTUK ADMIN - GET PROFIL DIRI SENDIRI
app.get('/api/admin/profile', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak.' });
  }

  const userId = req.user.userId;
  // Ambil data admin saat ini (kecuali password)
  const query = 'SELECT id, nama_lengkap, email, no_telepon FROM users WHERE id = ?';

  connection.query(query, [userId], (error, results) => {
    if (error) return res.status(500).json({ message: 'Kesalahan server.' });
    if (results.length === 0) return res.status(404).json({ message: 'Admin tidak ditemukan.' });
    res.status(200).json(results[0]);
  });
});

// 19. API UNTUK ADMIN - UPDATE PROFIL DIRI SENDIRI
app.put('/api/admin/profile', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Akses ditolak.' });
  }

  const userId = req.user.userId;
  const { nama_lengkap, email, no_telepon, password_baru } = req.body;

  if (!nama_lengkap || !email) {
    return res.status(400).json({ message: 'Nama dan Email wajib diisi.' });
  }

  let query, values;

  try {
    if (password_baru) {
      // Jika admin ingin ganti password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password_baru, salt);
      
      query = 'UPDATE users SET nama_lengkap = ?, email = ?, no_telepon = ?, password = ? WHERE id = ?';
      values = [nama_lengkap, email, no_telepon || null, hashedPassword, userId];
    } else {
      // Jika tidak ganti password
      query = 'UPDATE users SET nama_lengkap = ?, email = ?, no_telepon = ? WHERE id = ?';
      values = [nama_lengkap, email, no_telepon || null, userId];
    }

    connection.query(query, values, (error, results) => {
      if (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email sudah digunakan akun lain.' });
        return res.status(500).json({ message: 'Gagal mengupdate profil.' });
      }
      res.status(200).json({ message: 'Profil berhasil diupdate!' });
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error saat hashing password.' });
  }
});

// 20. Menjalankan server
app.listen(port, () => {
  console.log(`Server backend berjalan di http://localhost:${port}`);
});