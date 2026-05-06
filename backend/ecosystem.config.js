module.exports = {
  apps: [
    {
      name: 'obiimy-chat',
      script: 'server.js',
      cwd: '/var/www/obiimy-chat/backend',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 8090,
        GEMINI_FLASH_MODEL: 'gemini-2.5-flash',
        GEMINI_PRO_MODEL: 'gemini-2.5-pro',
        OPENAI_MODEL: 'gpt-4o'
        // GEMINI_API_KEY / OPENAI_API_KEY come from /var/www/obiimy-chat/backend/.env on the server
      }
    }
  ]
};
