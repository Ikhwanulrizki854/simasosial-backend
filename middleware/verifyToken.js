const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 

  if (token == null) {
    return res.status(401).json({ message: 'Akses ditolak. Token tidak ada.' });
  }

  // Ganti 'RAHASIA_SUPER_AMAN' ini dengan string acak Anda
  jwt.verify(token, 'RAHASIA_SUPER_AMAN', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Token tidak valid.' });
    }
    req.user = user;
    next(); 
  });
};

module.exports = verifyToken;