const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs");
const { google } = require("googleapis");

// 載入環境變數
require("dotenv").config();

// 檢查必要的環境變數
const requiredEnvVars = ["BOT_TOKEN", "CLIENT_ID", "GUILD_ID", "ADMIN_ROLE_ID"];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error("❌ 缺少必要的環境變數:");
  missingVars.forEach((varName) => {
    console.error(`   - ${varName}`);
  });
  console.error("\n請檢查你的 .env 檔案是否包含所有必要的變數。");
  process.exit(1);
}

// 設定檔
const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID,
  warningThresholds: {
    mute: 3, // 3次警告後禁言
    kick: 5, // 5次警告後踢出
    ban: 7, // 7次警告後封鎖
  },
  sheets: {
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID, // 你的試算表ID
    range: "(不要亂動)總表!A:F", // 資料範圍
    reportChannelId: process.env.REPORT_CHANNEL_ID, // 限制報名的頻道ID
  },
  // Google服務帳號認證
  googleCredentials: {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
  },
  muteDuration: 24 * 60 * 60 * 1000, // 禁言24小時 (毫秒)
};

// 初始化客戶端
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// 資料儲存
let warningsData = {};
let marriageData = {};
let proposalData = {};
let divorceData = {};
let mutedMembers = {};

// Google Sheets 服務
let sheetsService;

// 初始化Google Sheets API
async function initGoogleSheets() {
  try {
    // 檢查是否有必要的Google設定
    if (
      !config.googleCredentials.project_id ||
      !config.googleCredentials.client_email
    ) {
      console.log(
        "⚠️ Google Sheets 相關環境變數未設定，跳過 Google Sheets 功能"
      );
      return;
    }

    const auth = new google.auth.GoogleAuth({
      credentials: config.googleCredentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    sheetsService = google.sheets({ version: "v4", auth });
    console.log("✅ Google Sheets API 初始化成功");
  } catch (error) {
    console.error("❌ Google Sheets API 初始化失敗:", error.message);
  }
}

// 解析報名格式的函數
function parseRegistrationMessage(content) {
  const regex =
    /職業[：:]\s*(.+?)\s+等級[：:]\s*(.+?)\s+乾表[：:]\s*(.+?)\s+可打時間[：:]\s*(.+?)(?:\s|$)/;
  const match = content.match(regex);

  if (!match) {
    return null;
  }

  return {
    職業: match[1].trim(),
    等級: match[2].trim(),
    乾表: match[3].trim(),
    可打時間: match[4].trim(),
  };
}

// 添加資料到Google試算表
async function addToGoogleSheets(userData) {
  if (!sheetsService) {
    console.error("Google Sheets 服務未初始化");
    return false;
  }

  try {
    const values = [
      [
        userData.發文者,
        userData.職業,
        userData.等級,
        userData.乾表,
        userData.可打時間,
        userData.發文時間,
      ],
    ];

    const request = {
      spreadsheetId: config.sheets.spreadsheetId,
      range: "(不要亂動)總表!A:F",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: values,
      },
    };

    const response = await sheetsService.spreadsheets.values.append(request);
    console.log(
      `✅ 資料已添加到試算表: ${response.data.updates.updatedRows} 行`
    );
    return true;
  } catch (error) {
    console.error("❌ 添加資料到試算表失敗:", error);
    return false;
  }
}

// 檢查是否為重複報名
async function checkDuplicateRegistration(username) {
  if (!sheetsService) {
    return false;
  }

  try {
    const response = await sheetsService.spreadsheets.values.get({
      spreadsheetId: config.sheets.spreadsheetId,
      range: "(不要亂動)總表!A:A",
    });

    const values = response.data.values || [];

    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === username) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("檢查重複報名時出錯:", error);
    return false;
  }
}

// 載入資料函式
function loadWarnings() {
  try {
    if (fs.existsSync("./warnings.json")) {
      const data = fs.readFileSync("./warnings.json", "utf8");
      if (data.trim()) {
        warningsData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error("載入警告資料失敗:", error);
    warningsData = {};
  }
}

function loadMarriages() {
  try {
    if (fs.existsSync("./marriages.json")) {
      const data = fs.readFileSync("./marriages.json", "utf8");
      if (data.trim()) {
        marriageData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error("載入結婚資料失敗:", error);
    marriageData = {};
  }
}

function loadProposals() {
  try {
    if (fs.existsSync("./proposals.json")) {
      const data = fs.readFileSync("./proposals.json", "utf8");
      if (data.trim()) {
        proposalData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error("載入求婚資料失敗:", error);
    proposalData = {};
  }
}

function loadDivorces() {
  try {
    if (fs.existsSync("./divorces.json")) {
      const data = fs.readFileSync("./divorces.json", "utf8");
      if (data.trim()) {
        divorceData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error("載入離婚資料失敗:", error);
    divorceData = {};
  }
}

function loadMutedMembers() {
  try {
    if (fs.existsSync("./muted_members.json")) {
      const data = fs.readFileSync("./muted_members.json", "utf8");
      if (data.trim()) {
        mutedMembers = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error("載入禁言資料失敗:", error);
    mutedMembers = {};
  }
}

// 儲存資料函式
function saveWarnings() {
  try {
    fs.writeFileSync("./warnings.json", JSON.stringify(warningsData, null, 2));
  } catch (error) {
    console.error("儲存警告資料失敗:", error);
  }
}

function saveMarriages() {
  try {
    fs.writeFileSync("./marriages.json", JSON.stringify(marriageData, null, 2));
  } catch (error) {
    console.error("儲存結婚資料失敗:", error);
  }
}

function saveProposals() {
  try {
    fs.writeFileSync("./proposals.json", JSON.stringify(proposalData, null, 2));
  } catch (error) {
    console.error("儲存求婚資料失敗:", error);
  }
}

function saveDivorces() {
  try {
    fs.writeFileSync("./divorces.json", JSON.stringify(divorceData, null, 2));
  } catch (error) {
    console.error("儲存離婚資料失敗:", error);
  }
}

function saveMutedMembers() {
  try {
    fs.writeFileSync(
      "./muted_members.json",
      JSON.stringify(mutedMembers, null, 2)
    );
  } catch (error) {
    console.error("儲存禁言資料失敗:", error);
  }
}

// 輔助函式
function isAdmin(member) {
  return (
    member.roles.cache.has(config.adminRoleId) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function isMarried(userId) {
  return marriageData[userId] !== undefined;
}

function createMarriage(userId1, userId2) {
  const marriageDate = new Date().toISOString();
  marriageData[userId1] = { spouse: userId2, marriageDate };
  marriageData[userId2] = { spouse: userId1, marriageDate };
  saveMarriages();
}

function deleteMarriage(userId1, userId2) {
  delete marriageData[userId1];
  delete marriageData[userId2];
  saveMarriages();
}

function getUserWarnings(userId) {
  if (!warningsData[userId]) {
    warningsData[userId] = {
      count: 0,
      warnings: [],
      lastWarning: null,
    };
  }
  return warningsData[userId];
}

// 清理過期求婚
function cleanExpiredProposals() {
  const now = Date.now();
  const expiredTime = 30 * 60 * 1000;

  for (const proposalId in proposalData) {
    const proposal = proposalData[proposalId];
    if (now - proposal.timestamp > expiredTime) {
      delete proposalData[proposalId];
      console.log(`求婚 ${proposalId} 已過期並被清理`);
    }
  }
  saveProposals();
}

function cleanExpiredDivorces() {
  const now = Date.now();
  const expiredTime = 30 * 60 * 1000;

  for (const divorceId in divorceData) {
    const divorce = divorceData[divorceId];
    if (now - divorce.timestamp > expiredTime) {
      delete divorceData[divorceId];
      console.log(`離婚申請 ${divorceId} 已過期並被清理`);
    }
  }
  saveDivorces();
}

// 檢查禁言到期
async function checkMutedMembers() {
  const now = Date.now();

  for (const userId in mutedMembers) {
    const muteData = mutedMembers[userId];
    if (now >= muteData.unmuteTime) {
      try {
        const guild = client.guilds.cache.get(muteData.guildId);
        if (guild) {
          const member = await guild.members.fetch(userId);
          const user = member.user;

          if (!member.isCommunicationDisabled()) {
            try {
              const dmEmbed = new EmbedBuilder()
                .setColor("#32CD32")
                .setTitle("🔊 禁言時間已到期")
                .setDescription(`你在 **${guild.name}** 伺服器的禁言時間已結束`)
                .addFields(
                  { name: "原禁言原因", value: muteData.reason },
                  { name: "禁言時長", value: `${muteData.duration}分鐘` },
                  {
                    name: "解除時間",
                    value: new Date().toLocaleString("zh-TW"),
                  }
                )
                .setFooter({ text: "歡迎回來！請繼續遵守伺服器規則～" });

              await user.send({ embeds: [dmEmbed] });
              console.log(`已通知 ${user.tag} 禁言到期`);
            } catch (error) {
              console.log(
                `無法向 ${user.tag} 發送禁言到期通知:`,
                error.message
              );
            }
          }
        }
        delete mutedMembers[userId];
      } catch (error) {
        console.error(`檢查禁言到期時出錯 (${userId}):`, error);
        delete mutedMembers[userId];
      }
    }
  }
  saveMutedMembers();
}

// 添加警告
async function addWarning(user, moderator, reason, guild) {
  const userData = getUserWarnings(user.id);
  const warning = {
    id: Date.now(),
    reason: reason,
    moderator: moderator.id,
    timestamp: new Date().toISOString(),
  };

  userData.warnings.push(warning);
  userData.count++;
  userData.lastWarning = new Date().toISOString();

  saveWarnings();

  // 發送私訊通知
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("⚠️ 警告通知")
      .setDescription(`你在 **${guild.name}** 伺服器中收到了一個警告！！`)
      .addFields(
        { name: "警告原因", value: reason },
        { name: "執行管理員", value: moderator.displayName },
        { name: "當前警告次數", value: `${userData.count}次` },
        { name: "時間", value: new Date().toLocaleString("zh-TW") }
      )
      .setFooter({ text: "請遵守伺服器規則，避免進一步的處罰！霸脫霸脫～" });

    await user.send({ embeds: [dmEmbed] });
    console.log(`已成功向 ${user.tag} 發送警告通知`);
  } catch (error) {
    console.log(`無法向 ${user.tag} 發送私訊:`, error.message);
  }

  await checkAutoActions(user, guild, userData.count);
  return warning;
}

// 檢查自動處罰
async function checkAutoActions(user, guild, warningCount) {
  const member = guild.members.cache.get(user.id);
  if (!member) return;

  try {
    if (warningCount >= config.warningThresholds.ban) {
      await member.ban({
        reason: `自動封鎖 - 達到${config.warningThresholds.ban}次警告`,
      });
      console.log(`成員 ${user.tag} 因達到${warningCount}次警告被自動封鎖`);
    } else if (warningCount >= config.warningThresholds.kick) {
      await member.kick(
        `自動踢出 - 達到${config.warningThresholds.kick}次警告`
      );
      console.log(`成員 ${user.tag} 因達到${warningCount}次警告被自動踢出`);
    } else if (warningCount >= config.warningThresholds.mute) {
      await member.timeout(
        config.muteDuration,
        `自動禁言 - 達到${config.warningThresholds.mute}次警告`
      );
      console.log(`成員 ${user.tag} 因達到${warningCount}次警告被自動禁言`);
    }
  } catch (error) {
    console.error("執行自動懲處時出錯:", error);
  }
}

// 建立斜杠指令
const commands = [
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("警告成員")
    .addUserOption((option) =>
      option.setName("user").setDescription("要警告的成員").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("警告原因").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("check_warn")
    .setDescription("查看成員警告紀錄")
    .addUserOption((option) =>
      option.setName("user").setDescription("要查看的成員").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("delete_warn")
    .setDescription("刪除成員的一個警告")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("要刪除警告的成員")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName("warn_id").setDescription("警告ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clear_all_warn")
    .setDescription("清除成員所有的警告")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("要清除警告的成員")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("踢出成員")
    .addUserOption((option) =>
      option.setName("user").setDescription("要踢出的成員").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("踢出原因").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("封鎖成員")
    .addUserOption((option) =>
      option.setName("user").setDescription("要封鎖的成員").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("封鎖原因").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("禁言成員")
    .addUserOption((option) =>
      option.setName("user").setDescription("要禁言的成員").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("mute_duration")
        .setDescription("禁言時長(分鐘)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("禁言原因").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("解除成員禁言")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("要解除禁言的成員")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("propose")
    .setDescription("向某個成員求婚")
    .addUserOption((option) =>
      option.setName("user").setDescription("要求婚的成員").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("marriage")
    .setDescription("查看婚姻狀態")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("要查看的成員（不填則查看自己）")
        .setRequired(false)
    ),

  new SlashCommandBuilder().setName("divorce").setDescription("申請離婚"),

  // 報名統計指令
  new SlashCommandBuilder()
    .setName("registration_stats")
    .setDescription("查看當前報名統計"),
];

// 註冊斜杠指令
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);

  try {
    console.log("開始註冊斜杠指令...");
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log("斜杠指令註冊成功!");
  } catch (error) {
    console.error("註冊斜杠指令失敗:", error);
  }
}

// 處理報名統計指令
async function handleRegistrationStatsCommand(interaction) {
  if (!sheetsService) {
    await interaction.reply({
      content: "❌ Google Sheets 服務未可用！",
      flags: 64,
    });
    return;
  }

  try {
    const response = await sheetsService.spreadsheets.values.get({
      spreadsheetId: config.sheets.spreadsheetId,
      range: "(不要亂動)總表!A:F",
    });

    const values = response.data.values || [];
    const registrationCount = Math.max(0, values.length - 1);

    const statsEmbed = new EmbedBuilder()
      .setColor("#4169E1")
      .setTitle("📊 報名統計")
      .addFields(
        { name: "總報名人數", value: `${registrationCount} 人`, inline: true },
        {
          name: "試算表連結",
          value: `[點擊查看](https://docs.google.com/spreadsheets/d/${config.sheets.spreadsheetId})`,
        }
      )
      .setTimestamp();

    if (registrationCount > 0) {
      const recentRegistrations = values.slice(-3).reverse();
      let recentText = "";

      recentRegistrations.forEach((row, index) => {
        if (row.length >= 4) {
          recentText += `${row[0]} (${row[1]}, Lv.${row[2]})\n`;
        }
      });

      if (recentText) {
        statsEmbed.addFields({
          name: "最近報名",
          value: recentText || "無資料",
          inline: false,
        });
      }
    }

    await interaction.reply({ embeds: [statsEmbed] });
  } catch (error) {
    console.error("獲取報名統計失敗:", error);
    await interaction.reply({
      content: "❌ 獲取統計資料時發生錯誤！",
      flags: 64,
    });
  }
}

// 處理指令函數（簡化版，只顯示關鍵部分）
async function handleWarnCommand(interaction) {
  const user = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason");
  const moderator = interaction.member;

  const warning = await addWarning(user, moderator, reason, interaction.guild);
  const userData = getUserWarnings(user.id);

  const embed = new EmbedBuilder()
    .setColor("#FF6B6B")
    .setTitle("⚠️ 成員已被警告")
    .addFields(
      { name: "成員", value: `${user}`, inline: true },
      { name: "管理員", value: `${moderator}`, inline: true },
      { name: "原因", value: reason },
      { name: "警告次數", value: `${userData.count}次`, inline: true },
      { name: "警告ID", value: `${warning.id}`, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// 其他指令處理函數省略，但結構相同...

// 訊息監聽事件 - 處理報名
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // 只在有設定報名頻道時才處理
  if (!sheetsService || !config.sheets.reportChannelId) return;
  if (message.channel.id !== config.sheets.reportChannelId) return;

  const registrationData = parseRegistrationMessage(message.content);

  if (!registrationData) {
    const formatEmbed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("❌ 報名格式錯誤")
      .setDescription("請使用正確的報名格式：")
      .addFields({
        name: "正確格式",
        value:
          "```職業：你的職業 等級：你的等級 乾表：你的乾表 可打時間：你的可打時間```",
      })
      .addFields({
        name: "範例",
        value: "```職業：刀賊 等級：105 乾表：2400 可打時間：每日19點後```",
      })
      .setFooter({ text: "請重新發送正確格式的報名訊息" });

    try {
      await message.reply({ embeds: [formatEmbed] });
      await message.delete();
    } catch (error) {
      console.log("發送格式提醒失敗:", error.message);
    }
    return;
  }

  const isDuplicate = await checkDuplicateRegistration(
    message.author.displayName || message.author.username
  );

  if (isDuplicate) {
    const duplicateEmbed = new EmbedBuilder()
      .setColor("#FFA500")
      .setTitle("⚠️ 重複報名")
      .setDescription("你已經報名過了！如需修改請聯繫管理員。")
      .setFooter({ text: "每人只能報名一次" });

    try {
      await message.reply({ embeds: [duplicateEmbed] });
      await message.delete();
    } catch (error) {
      console.log("發送重複報名提醒失敗:", error.message);
    }
    return;
  }

  const userData = {
    發文者: message.author.displayName || message.author.username,
    職業: registrationData.職業,
    等級: registrationData.等級,
    乾表: registrationData.乾表,
    可打時間: registrationData.可打時間,
    發文時間: new Date()
      .toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "/"),
  };

  const success = await addToGoogleSheets(userData);

  if (success) {
    const successEmbed = new EmbedBuilder()
      .setColor("#32CD32")
      .setTitle("✅ 報名成功")
      .setDescription(`${userData.發文者} 的報名資料已記錄！`)
      .addFields(
        { name: "職業", value: userData.職業, inline: true },
        { name: "等級", value: userData.等級, inline: true },
        { name: "乾表", value: userData.乾表, inline: true },
        { name: "可打時間", value: userData.可打時間 },
        { name: "報名時間", value: userData.發文時間 }
      )
      .setThumbnail(message.author.displayAvatarURL())
      .setFooter({ text: "資料已同步至試算表" });

    try {
      await message.reply({ embeds: [successEmbed] });
      await message.react("✅");
    } catch (error) {
      console.log("發送報名成功回覆失敗:", error.message);
    }
  } else {
    const errorEmbed = new EmbedBuilder()
      .setColor("#FF0000")
      .setTitle("❌ 報名失敗")
      .setDescription("儲存到試算表時發生錯誤，請聯繫管理員。")
      .setFooter({ text: "請稍後再試或聯繫技術支援" });

    try {
      await message.reply({ embeds: [errorEmbed] });
      await message.react("❌");
    } catch (error) {
      console.log("發送報名失敗回覆失敗:", error.message);
    }
  }
});

// 處理互動事件
client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const { commandName } = interaction;

  // 結婚系統指令和報名統計不需要管理員權限
  const publicCommands = [
    "propose",
    "marriage",
    "divorce",
    "registration_stats",
  ];

  if (!publicCommands.includes(commandName)) {
    if (!isAdmin(member)) {
      await interaction.reply({
        content: "❌ 你沒有權限使用此指令！",
        flags: 64,
      });
      return;
    }
  }

  try {
    switch (commandName) {
      case "registration_stats":
        await handleRegistrationStatsCommand(interaction);
        break;
      case "warn":
        await handleWarnCommand(interaction);
        break;
      case "check_warn":
        await handleCheckWarnCommand(interaction);
        break;
      case "delete_warn":
        await handleDeleteWarnCommand(interaction);
        break;
      case "clear_all_warn":
        await handleClearAllWarnCommand(interaction);
        break;
      case "kick":
        await handleKickCommand(interaction);
        break;
      case "ban":
        await handleBanCommand(interaction);
        break;
      case "mute":
        await handleMuteCommand(interaction);
        break;
      case "unmute":
        await handleUnmuteCommand(interaction);
        break;
      case "propose":
        await handleProposeCommand(interaction);
        break;
      case "marriage":
        await handleMarriageCommand(interaction);
        break;
      case "divorce":
        await handleDivorceCommand(interaction);
        break;
    }
  } catch (error) {
    console.error("處理指令時出錯:", error);
    const isReplied = interaction.replied || interaction.deferred;
    if (!isReplied) {
      await interaction.reply({
        content: "❌ 執行指令時發生錯誤！",
        flags: 64,
      });
    }
  }
});

// 其他必要的處理函數（簡化版）
async function handleCheckWarnCommand(interaction) {
  const user = interaction.options.getUser("user");
  const userData = getUserWarnings(user.id);

  if (userData.count === 0) {
    await interaction.reply({
      content: `📋 ${user.tag} 沒有任何警告紀錄。`,
      flags: 64,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("#FFA500")
    .setTitle(`📋 ${user.tag} 的警告紀錄`)
    .setDescription(`總警告次數: ${userData.count}`)
    .setThumbnail(user.displayAvatarURL());

  userData.warnings.slice(-5).forEach((warning, index) => {
    const moderator = interaction.guild.members.cache.get(warning.moderator);
    embed.addFields({
      name: `警告 #${warning.id}`,
      value: `**原因:** ${warning.reason}\n**管理員:** ${
        moderator ? moderator.displayName : "未知"
      }\n**時間:** ${new Date(warning.timestamp).toLocaleString("zh-TW")}`,
      inline: false,
    });
  });

  if (userData.warnings.length > 5) {
    embed.setFooter({
      text: `顯示最近五條警告，共${userData.warnings.length}條`,
    });
  }

  await interaction.reply({ embeds: [embed], flags: 64 });
}

async function handleDeleteWarnCommand(interaction) {
  const user = interaction.options.getUser("user");
  const warningId = interaction.options.getInteger("warn_id");
  const userData = getUserWarnings(user.id);

  const warningIndex = userData.warnings.findIndex((w) => w.id === warningId);

  if (warningIndex === -1) {
    await interaction.reply({
      content: "❌ 找不到指定的警告ID！",
      flags: 64,
    });
    return;
  }

  userData.warnings.splice(warningIndex, 1);
  userData.count = userData.warnings.length;
  saveWarnings();

  await interaction.reply({
    content: `✅ 已刪除 ${user.tag} 的警告 #${warningId}`,
    flags: 64,
  });
}

async function handleClearAllWarnCommand(interaction) {
  const user = interaction.options.getUser("user");
  const userData = getUserWarnings(user.id);

  if (userData.count === 0) {
    await interaction.reply({
      content: `📋 ${user.tag} 沒有任何警告紀錄需要清除。`,
      flags: 64,
    });
    return;
  }

  const originalCount = userData.count;
  delete warningsData[user.id];
  saveWarnings();

  await interaction.reply({
    content: `✅ 已清除 ${user.tag} 的所有警告紀錄！（共清除了 ${originalCount} 條警告）`,
    flags: 64,
  });
}

async function handleKickCommand(interaction) {
  const user = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason") || "未提供原因";
  const member = interaction.guild.members.cache.get(user.id);

  if (!member) {
    await interaction.reply({
      content: "❌ 成員不在伺服器中！",
      flags: 64,
    });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({
      content: "❌ 無法踢出此成員！",
      flags: 64,
    });
    return;
  }

  try {
    await member.kick(reason);

    const embed = new EmbedBuilder()
      .setColor("#FF8C00")
      .setTitle("👢 成員已被踢出")
      .addFields(
        { name: "成員", value: `${user.tag}`, inline: true },
        { name: "管理員", value: `${interaction.member}`, inline: true },
        { name: "原因", value: reason }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("踢出成員時出錯:", error);
    await interaction.reply({
      content: "❌ 踢出成員時發生錯誤！",
      flags: 64,
    });
  }
}

async function handleBanCommand(interaction) {
  const user = interaction.options.getUser("user");
  const reason = interaction.options.getString("reason") || "未提供原因";
  const member = interaction.guild.members.cache.get(user.id);

  if (member && !member.bannable) {
    await interaction.reply({
      content: "❌ 無法封鎖此成員！",
      flags: 64,
    });
    return;
  }

  try {
    await interaction.guild.members.ban(user, { reason });

    const embed = new EmbedBuilder()
      .setColor("#DC143C")
      .setTitle("🔨 成員已被封鎖")
      .addFields(
        { name: "成員", value: `${user.tag}`, inline: true },
        { name: "管理員", value: `${interaction.member}`, inline: true },
        { name: "原因", value: reason }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("封鎖成員時出錯:", error);
    await interaction.reply({
      content: "❌ 封鎖成員時發生錯誤！",
      flags: 64,
    });
  }
}

async function handleMuteCommand(interaction) {
  const user = interaction.options.getUser("user");
  const duration = interaction.options.getInteger("mute_duration");
  const reason = interaction.options.getString("reason") || "未提供原因";
  const member = interaction.guild.members.cache.get(user.id);

  if (!member) {
    await interaction.reply({
      content: "❌ 成員不在伺服器中！",
      flags: 64,
    });
    return;
  }

  if (!member.moderatable) {
    await interaction.reply({
      content: "❌ 無法禁言此成員！",
      flags: 64,
    });
    return;
  }

  if (duration <= 0 || duration > 40320) {
    await interaction.reply({
      content: "❌ 禁言時長必須在1-40320分鐘之間！",
      flags: 64,
    });
    return;
  }

  try {
    const timeoutDuration = duration * 60 * 1000;
    const unmuteTime = Date.now() + timeoutDuration;

    mutedMembers[user.id] = {
      guildId: interaction.guild.id,
      reason: reason,
      duration: duration,
      unmuteTime: unmuteTime,
      mutedBy: interaction.member.id,
      mutedAt: Date.now(),
    };
    saveMutedMembers();

    await member.timeout(timeoutDuration, reason);

    const embed = new EmbedBuilder()
      .setColor("#9932CC")
      .setTitle("🔇 成員已被禁言")
      .addFields(
        { name: "成員", value: `${user.tag}`, inline: true },
        { name: "管理員", value: `${interaction.member}`, inline: true },
        { name: "時長", value: `${duration}分鐘`, inline: true },
        { name: "原因", value: reason }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("禁言成員時出錯:", error);
    await interaction.reply({
      content: "❌ 禁言成員時發生錯誤！",
      flags: 64,
    });
  }
}

async function handleUnmuteCommand(interaction) {
  const user = interaction.options.getUser("user");
  const member = interaction.guild.members.cache.get(user.id);

  if (!member) {
    await interaction.reply({
      content: "❌ 成員不在伺服器中！",
      flags: 64,
    });
    return;
  }

  if (!member.isCommunicationDisabled()) {
    await interaction.reply({
      content: "❌ 此成員沒有被禁言！",
      flags: 64,
    });
    return;
  }

  try {
    await member.timeout(null);

    if (mutedMembers[user.id]) {
      delete mutedMembers[user.id];
      saveMutedMembers();
    }

    const embed = new EmbedBuilder()
      .setColor("#32CD32")
      .setTitle("🔊 成員禁言已解除")
      .addFields(
        { name: "成員", value: `${user.tag}`, inline: true },
        { name: "管理員", value: `${interaction.member}`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("解除禁言時出錯:", error);
    await interaction.reply({
      content: "❌ 解除禁言時發生錯誤！",
      flags: 64,
    });
  }
}

// 簡化的結婚系統處理函數
async function handleProposeCommand(interaction) {
  const proposer = interaction.user;
  const target = interaction.options.getUser("user");

  if (proposer.id === target.id) {
    await interaction.reply({
      content: "❌ 你不能對自己求婚啦！",
      flags: 64,
    });
    return;
  }

  if (isMarried(proposer.id) || isMarried(target.id)) {
    await interaction.reply({
      content: "❌ 其中一方已經結婚了！",
      flags: 64,
    });
    return;
  }

  const proposalId = `${proposer.id}_${target.id}_${Date.now()}`;
  proposalData[proposalId] = {
    proposer: proposer.id,
    target: target.id,
    timestamp: Date.now(),
    guildId: interaction.guild.id,
  };
  saveProposals();

  const acceptButton = new ButtonBuilder()
    .setCustomId(`accept_${proposalId}`)
    .setLabel("💍 接受")
    .setStyle(ButtonStyle.Success);

  const rejectButton = new ButtonBuilder()
    .setCustomId(`reject_${proposalId}`)
    .setLabel("💔 拒絕")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(acceptButton, rejectButton);

  const proposalEmbed = new EmbedBuilder()
    .setColor("#FF69B4")
    .setTitle("💍 求婚通知")
    .setDescription(`${proposer} 向 ${target} 求婚！`)
    .addFields(
      { name: "💕 求婚訊息", value: `${target}，你願意和我結婚嗎？` },
      { name: "⏰ 有效時間", value: "30分鐘" }
    )
    .setTimestamp();

  await interaction.reply({
    embeds: [proposalEmbed],
    components: [row],
  });
}

async function handleMarriageCommand(interaction) {
  const targetUser = interaction.options.getUser("user") || interaction.user;

  if (!isMarried(targetUser.id)) {
    const singleEmbed = new EmbedBuilder()
      .setColor("#808080")
      .setTitle("💔 單身狀態")
      .setDescription("目前是單身狀態")
      .setTimestamp();

    await interaction.reply({ embeds: [singleEmbed], flags: 64 });
    return;
  }

  const spouseData = marriageData[targetUser.id];
  const spouse = await interaction.guild.members.fetch(spouseData.spouse);
  const marriageDate = new Date(spouseData.marriageDate);

  const marriageEmbed = new EmbedBuilder()
    .setColor("#FFD700")
    .setTitle("💕 婚姻狀態")
    .setDescription(`${targetUser.displayName} 和 ${spouse.displayName} 已結婚`)
    .addFields({
      name: "💒 結婚日期",
      value: marriageDate.toLocaleString("zh-TW"),
    })
    .setTimestamp();

  await interaction.reply({ embeds: [marriageEmbed], flags: 64 });
}

async function handleDivorceCommand(interaction) {
  const user = interaction.user;

  if (!isMarried(user.id)) {
    await interaction.reply({
      content: "❌ 你還沒有結婚，無法離婚！",
      flags: 64,
    });
    return;
  }

  const spouseData = marriageData[user.id];
  const spouse = await interaction.guild.members.fetch(spouseData.spouse);

  const divorceId = `${user.id}_${spouseData.spouse}_${Date.now()}`;
  divorceData[divorceId] = {
    applicant: user.id,
    spouse: spouseData.spouse,
    timestamp: Date.now(),
    guildId: interaction.guild.id,
  };
  saveDivorces();

  const acceptButton = new ButtonBuilder()
    .setCustomId(`divorce_accept_${divorceId}`)
    .setLabel("💔 同意離婚")
    .setStyle(ButtonStyle.Danger);

  const rejectButton = new ButtonBuilder()
    .setCustomId(`divorce_reject_${divorceId}`)
    .setLabel("💕 拒絕離婚")
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(acceptButton, rejectButton);

  const divorceEmbed = new EmbedBuilder()
    .setColor("#8B4513")
    .setTitle("💔 離婚申請")
    .setDescription(`${user} 向 ${spouse} 提出離婚申請`)
    .addFields({ name: "⏰ 有效時間", value: "30分鐘" })
    .setTimestamp();

  await interaction.reply({
    embeds: [divorceEmbed],
    components: [row],
  });
}

// 按鈕處理函數
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith("accept_") || customId.startsWith("reject_")) {
    await handleProposalButtons(interaction, customId);
  } else if (
    customId.startsWith("divorce_accept_") ||
    customId.startsWith("divorce_reject_")
  ) {
    await handleDivorceButtons(interaction, customId);
  }
}

async function handleProposalButtons(interaction, customId) {
  let action, proposalId;

  if (customId.startsWith("accept_")) {
    action = "accept";
    proposalId = customId.substring(7);
  } else {
    action = "reject";
    proposalId = customId.substring(7);
  }

  const proposal = proposalData[proposalId];
  if (!proposal || interaction.user.id !== proposal.target) {
    await interaction.reply({
      content: "❌ 無效的操作！",
      flags: 64,
    });
    return;
  }

  if (action === "accept") {
    createMarriage(proposal.proposer, proposal.target);
    delete proposalData[proposalId];
    saveProposals();

    const marriageEmbed = new EmbedBuilder()
      .setColor("#FFD700")
      .setTitle("🎉 結婚公告")
      .setDescription("恭喜結為夫妻！")
      .setTimestamp();

    await interaction.update({
      embeds: [marriageEmbed],
      components: [],
    });
  } else {
    delete proposalData[proposalId];
    saveProposals();

    const rejectEmbed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("💔 求婚被拒絕")
      .setTimestamp();

    await interaction.update({
      embeds: [rejectEmbed],
      components: [],
    });
  }
}

async function handleDivorceButtons(interaction, customId) {
  let action, divorceId;

  if (customId.startsWith("divorce_accept_")) {
    action = "accept";
    divorceId = customId.substring(15);
  } else {
    action = "reject";
    divorceId = customId.substring(15);
  }

  const divorce = divorceData[divorceId];
  if (!divorce || interaction.user.id !== divorce.spouse) {
    await interaction.reply({
      content: "❌ 無效的操作！",
      flags: 64,
    });
    return;
  }

  if (action === "accept") {
    deleteMarriage(divorce.applicant, divorce.spouse);
    delete divorceData[divorceId];
    saveDivorces();

    const divorceEmbed = new EmbedBuilder()
      .setColor("#8B4513")
      .setTitle("📋 離婚證明")
      .setDescription("離婚手續已完成")
      .setTimestamp();

    await interaction.update({
      embeds: [divorceEmbed],
      components: [],
    });
  } else {
    delete divorceData[divorceId];
    saveDivorces();

    const rejectEmbed = new EmbedBuilder()
      .setColor("#32CD32")
      .setTitle("💕 離婚申請被拒絕")
      .setTimestamp();

    await interaction.update({
      embeds: [rejectEmbed],
      components: [],
    });
  }
}

// 機器人就緒事件
client.once("ready", async () => {
  console.log(`機器人已登入: ${client.user.tag}`);

  // 載入所有資料
  loadWarnings();
  loadMarriages();
  loadProposals();
  loadDivorces();
  loadMutedMembers();

  // 初始化Google Sheets
  await initGoogleSheets();

  // 註冊指令
  await registerCommands();

  console.log("✅ 所有系統已載入完成");

  // 定時清理
  setInterval(() => {
    cleanExpiredProposals();
    cleanExpiredDivorces();
  }, 10 * 60 * 1000);

  setInterval(checkMutedMembers, 1 * 60 * 1000);
});

// 啟動機器人
client.login(config.token);
