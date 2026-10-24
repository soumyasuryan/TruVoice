const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  const env = {};

  if (!fs.existsSync(filePath)) return env;

  const content = fs.readFileSync(filePath, "utf8");
  
  content.split(/\r?\n/).forEach((line) => {
    const match = line.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/
    );

    if (!match) return;

    let [, key, value] = match;

    if (!value) {
      env[key] = "";
      return;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  });

  return env;
}

const env = {
  ...process.env,
  ...loadEnvFile(path.resolve(__dirname, ".env.local")),
};

module.exports = ({ config }) => ({
  ...config,

  android: {
    ...config.android,
    package: "com.anonymous.TruVoice",
  },

  extra: {
    ...config.extra,

    apiUrl:
      env.EXPO_PUBLIC_API_URL ||
      env.REACT_NATIVE_API_URL ||
      env.API_URL ||
      env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000",

    agoraAppId:
      env.EXPO_PUBLIC_AGORA_APP_ID ||
      env.AGORA_APP_ID ||
      "",
  },
});