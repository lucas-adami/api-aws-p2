require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const mysql = require('mysql2/promise');
const AWS = require('aws-sdk');
const swaggerDocs = require('./swagger');
const { logInfo, logError } = require('./logger');

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: '*' }));
app.use(express.json());

/**
 * #####################
 * ### MONGODB SETUP ###
 * #####################
 */
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => logInfo('MongoDB conectado', null))
  .catch(err => logError('Erro ao conectar MongoDB: ' + err, null, err));

const UserSchema = new mongoose.Schema({ name: String, email: String });
const User = mongoose.model('Usuario', UserSchema);

// Testar conexão
app.get('/mongodb/testar-conexao', async (req, res) => {
    try {
        const user = await User.findOne();
        logInfo('Conexão MongoDB bem-sucedida', req);
        if (user) {
            res.status(200).send('Conexão com MongoDB OK e usuário encontrado!');
        } else {
            res.status(200).send('Conexão com MongoDB OK, mas sem usuários.');
        }
    } catch (error) {
        logError('Erro conexão MongoDB', req, error);
        res.status(500).send('Erro na conexão com MongoDB');
    } finally {
        mongoose.connection.close();
    }
});

// CRUD MongoDB
app.post('/usuarios', async (req, res) => {
    try {
        const user = new User(req.body);
        await user.save();
        logInfo('Usuário criado', req);
        res.status(201).send(user);
    } catch (error) {
        logError("Erro ao criar usuário", req, error);
        res.status(500).send('Erro interno');
    }
});

app.get('/usuarios', async (req, res) => {
    try {
        const users = await User.find();
        logInfo('Usuários listados', req);
        res.send(users);
    } catch (error) {
        logError("Erro ao listar usuários", req, error);
        res.status(500).send('Erro interno');
    }
});

app.get('/usuarios/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).send('Usuário não encontrado');
        logInfo('Usuário encontrado', req);
        res.send(user);
    } catch (error) {
        logError("Erro ao buscar usuário", req, error);
        res.status(500).send('Erro interno');
    }
});

app.put('/usuarios/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!user) return res.status(404).send('Usuário não encontrado');
        logInfo('Usuário atualizado', req);
        res.send(user);
    } catch (error) {
        logError("Erro ao atualizar usuário", req, error);
        res.status(500).send('Erro interno');
    }
});

app.delete('/usuarios/:id', async (req, res) => {
    try {
        const result = await User.deleteOne({ _id: req.params.id });
        if (result.deletedCount === 0) return res.status(404).send('Usuário não encontrado');
        logInfo('Usuário removido', req);
        res.send({ message: 'Usuário removido com sucesso' });
    } catch (error) {
        logError("Erro ao remover usuário", req, error);
        res.status(500).send('Erro interno');
    }
});

/**
 * ##################
 * ### AWS S3 SETUP #
 * ##################
 */
AWS.config.update({
    region: process.env.REGION,
    credentials: new AWS.Credentials({
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_ACCESS_KEY,
        sessionToken: process.env.SESSION_TOKEN
    })
});

const s3 = new AWS.S3();
const upload = multer({ storage: multer.memoryStorage() });

app.get('/buckets', async (req, res) => {
    try {
        const data = await s3.listBuckets().promise();
        logInfo('Buckets listados', req, data.Buckets);
        res.status(200).json(data.Buckets);
    } catch (error) {
        logError("Erro ao listar buckets", req, error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/buckets/:bucketName', async (req, res) => {
    const { bucketName } = req.params;
    try {
        const data = await s3.listObjectsV2({ Bucket: bucketName }).promise();
        logInfo('Objetos do bucket listados', req, data.Contents);
        res.status(200).json(data.Contents);
    } catch (error) {
        logError("Erro ao listar objetos", req, error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/buckets/:bucketName/upload', upload.single('file'), async (req, res) => {
    const { bucketName } = req.params;
    const file = req.file;

    if (!file) return res.status(400).json({ message: 'Arquivo não enviado' });

    const params = {
        Bucket: bucketName,
        Key: file.originalname,
        Body: file.buffer,
        ContentType: file.mimetype
    };

    try {
        const data = await s3.upload(params).promise();
        logInfo('Upload realizado', req, data);
        res.status(200).json({ message: 'Upload concluído', data });
    } catch (error) {
        logError('Erro no upload', req, error);
        res.status(500).json({ message: 'Erro no upload', error: error.message });
    }
});

app.delete('/buckets/:bucketName/file/:fileName', async (req, res) => {
    const { bucketName, fileName } = req.params;

    try {
        await s3.deleteObject({ Bucket: bucketName, Key: fileName }).promise();
        logInfo('Arquivo removido do bucket', req, fileName);
        res.status(200).json({ message: 'Arquivo deletado com sucesso' });
    } catch (error) {
        logError("Erro ao remover arquivo", req, error);
        res.status(500).json({ message: 'Erro ao deletar', error: error.message });
    }
});

/**
 * ###################
 * ### MYSQL SETUP ###
 * ###################
 */
const DB_NAME = process.env.MYSQL_DATABASE;

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

app.post('/init-db', async (req, res) => {
    try {
        const createDB = `
            CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;
            USE \`${DB_NAME}\`;
            CREATE TABLE IF NOT EXISTS produto (
                Id INT AUTO_INCREMENT PRIMARY KEY,
                Nome VARCHAR(255) NOT NULL,
                Descricao VARCHAR(255) NOT NULL,
                Preco DECIMAL(10,2) NOT NULL
            );
        `;
        await pool.query(createDB);
        res.send('Banco e tabela criados com sucesso');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/produtos', async (req, res) => {
    try {
        await pool.query(`USE \`${DB_NAME}\``);
        const [rows] = await pool.query('SELECT * FROM produto');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/produtos/:id', async (req, res) => {
    try {
        await pool.query(`USE \`${DB_NAME}\``);
        const [rows] = await pool.query('SELECT * FROM produto WHERE Id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/produtos', async (req, res) => {
    const { Nome, Descricao, Preco } = req.body;
    try {
        await pool.query(`USE \`${DB_NAME}\``);
        const [result] = await pool.query(
            'INSERT INTO produto (Nome, Descricao, Preco) VALUES (?, ?, ?)',
            [Nome, Descricao, Preco]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/produtos/:id', async (req, res) => {
    const { Nome, Descricao, Preco } = req.body;
    try {
        await pool.query(`USE \`${DB_NAME}\``);
        const [result] = await pool.query(
            'UPDATE produto SET Nome = ?, Descricao = ?, Preco = ? WHERE Id = ?',
            [Nome, Descricao, Preco, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Produto não encontrado' });
        res.json({ message: 'Produto atualizado com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/produtos/:id', async (req, res) => {
    try {
        await pool.query(`USE \`${DB_NAME}\``);
        const [result] = await pool.query('DELETE FROM produto WHERE Id = ?', [req.params.id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Produto não encontrado' });
        res.json({ message: 'Produto deletado com sucesso' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * #####################
 * ### INICIAR SERVER ##
 * #####################
 */
swaggerDocs(app);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
