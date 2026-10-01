import express, {Request , response, Response } from 'express'

const app = express()

const port = 3000
app.use(express.json())

app.get('/',( req : Request , res : Response) => {
    res.send('Hello, World!')
})

app.get('/health',( req : Request , res : Response) => {
    res.json({ message: 'Healthy' });
})

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`)
})