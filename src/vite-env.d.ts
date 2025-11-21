// Định nghĩa để TypeScript hiểu process.env.API_KEY
declare namespace NodeJS {
  interface ProcessEnv {
    API_KEY: string;
    [key: string]: string | undefined;
  }
}