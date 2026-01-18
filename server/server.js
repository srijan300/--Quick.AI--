import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { clerkMiddleware, requireAuth } from '@clerk/express'
import aiRouter from './routes/aiRoutes.js';
import connectCloudinary from './configs/cloudinary.js';
import userRouter from './routes/userRoutes.js';

const app = express()

await connectCloudinary()

app.use(cors())
app.use(express.json())
app.use(clerkMiddleware())

// Simple request logger to help diagnose network/CORS/auth issues
app.use((req, res, next) => {
    try {
        console.log('[incoming]', req.method, req.originalUrl, 'origin=', req.headers.origin, 'content-type=', req.headers['content-type']);
    } catch (e) {}
    next();
});

app.get('/', (req, res)=>res.send('Server is Live!'))

// Use per-route authentication via the `auth` middleware in routes.
// Removing the global `requireAuth()` avoids forcing auth on every request
// (file uploads and public endpoints can work correctly) since routes
// already apply `auth` where needed.
app.use('/api/ai', aiRouter)
app.use('/api/user', userRouter)

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

export default app;