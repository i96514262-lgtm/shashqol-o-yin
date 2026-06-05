const express = require('express');
const app = express();
const path = require('path');
app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/admin', (req, res) => {
    res.send('<form method="POST" action="/admin-login"><input type="password" name="pass" placeholder="Parol"><button type="submit">Kirish</button></form>');
});

app.post('/admin-login', (req, res) => {
    if (req.body.pass === "sizningparolingiz") {
        res.send("<h1>Admin Panel</h1><p>Bu yerdan o'yinni boshqarishingiz mumkin.</p>");
    } else {
        res.send("Xato parol! <a href='/admin'>Qaytadan</a>");
    }
});

app.listen(process.env.PORT || 3000);
