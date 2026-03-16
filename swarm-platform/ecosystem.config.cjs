module.exports = {
  apps: [{
    name: "swarm-platform",
    script: "src/server.js",
    node_args: "--env-file .env",
    cwd: __dirname,
    env: {
      RUNNER_MODE: "real"
    },
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    kill_timeout: 10000,
    listen_timeout: 8000
  }]
};
