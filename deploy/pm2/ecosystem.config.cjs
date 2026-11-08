const path = require("node:path");
module.exports = {
  apps: [{
    name: "wortkarten-api",
    cwd: path.resolve(__dirname, "../.."),
    script: "dist/main.js",
    interpreter: process.env.WORTKARTEN_NODE || process.execPath,
    node_args: ["--env-file=.env"],
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "512M",
    restart_delay: 3000,
    time: true,
    env: { NODE_ENV: "production" },
  }],
};
