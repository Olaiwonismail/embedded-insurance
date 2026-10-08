import express, { Request, Response } from 'express';
import 'dotenv/config';

import healthRoutes from './routes/health';
import usersRoutes from './routes/users';
const port = process.env.PORT 
const app = express();


app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.send('Hello, World!');
});

app.use('/health', healthRoutes);
app.use('/users', usersRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});