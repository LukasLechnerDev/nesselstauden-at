// @ts-check
import { defineConfig } from 'astro/config';

// CI passes the Pages base path ('/nesselstauden-at', or '' with a custom domain)
const base = (process.env.BASE_PATH ?? '/nesselstauden-at') + '/dorferneuerung';


export default defineConfig({
  site: 'https://example.github.io',
  base,
  trailingSlash: 'always',
});
