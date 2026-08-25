require('dotenv').config();

const express = require('express');
const app = require('./app');

app.use(express.static(app.staticDir));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`vertriebsportal.ch (lokaler Dev-Server) läuft auf http://localhost:${PORT}`);
});
