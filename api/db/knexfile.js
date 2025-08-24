import 'dotenv/config';
export default {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 0, max: 10 },
  // будет использовать схему rello, которую вы создали
  searchPath: ['rello', 'public'],
};