import { Router } from 'express';
import path from 'path';

// Built by the widget package's build script into server/public.
const BUNDLE = path.resolve(__dirname, '../../public/widget/v1/insureongo.js');

// Short, so a fix reaches merchants' pages quickly.
const CACHE_SECONDS = 300;

const router = Router();

router.get('/v1/insureongo.js', (_req, res, next) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  res.sendFile(BUNDLE, (err) => {
    if (err) next(err);
  });
});

export default router;
