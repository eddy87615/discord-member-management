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
} = require('discord.js');
const fs = require('fs');

// 載入環境變數
require('dotenv').config();

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
  muteDuration: 24 * 60 * 60 * 1000, // 禁言24小時 (毫秒)
};

// 檢查必要的環境變數
const requiredEnvVars = ['BOT_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'ADMIN_ROLE_ID'];
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('❌ 缺少必要的環境變數:');
  missingVars.forEach((varName) => {
    console.error(`   - ${varName}`);
  });
  console.error('\n請檢查你的 .env 檔案是否包含所有必要的變數。');
  process.exit(1);
}

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
let divorceData = {}; // 新增：離婚申請資料
let mutedMembers = {};

// 載入資料函式
function loadWarnings() {
  try {
    if (fs.existsSync('./warnings.json')) {
      const data = fs.readFileSync('./warnings.json', 'utf8');
      if (data.trim()) {
        warningsData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('載入警告資料失敗:', error);
    warningsData = {};
  }
}

function loadMarriages() {
  try {
    if (fs.existsSync('./marriages.json')) {
      const data = fs.readFileSync('./marriages.json', 'utf8');
      if (data.trim()) {
        marriageData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('載入結婚資料失敗:', error);
    marriageData = {};
  }
}

function loadProposals() {
  try {
    if (fs.existsSync('./proposals.json')) {
      const data = fs.readFileSync('./proposals.json', 'utf8');
      if (data.trim()) {
        proposalData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('載入求婚資料失敗:', error);
    proposalData = {};
  }
}

// 新增：載入離婚申請資料
function loadDivorces() {
  try {
    if (fs.existsSync('./divorces.json')) {
      const data = fs.readFileSync('./divorces.json', 'utf8');
      if (data.trim()) {
        divorceData = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('載入離婚資料失敗:', error);
    divorceData = {};
  }
}

function loadMutedMembers() {
  try {
    if (fs.existsSync('./muted_members.json')) {
      const data = fs.readFileSync('./muted_members.json', 'utf8');
      if (data.trim()) {
        mutedMembers = JSON.parse(data);
      }
    }
  } catch (error) {
    console.error('載入禁言資料失敗:', error);
    mutedMembers = {};
  }
}

// 儲存資料函式
function saveWarnings() {
  try {
    fs.writeFileSync('./warnings.json', JSON.stringify(warningsData, null, 2));
  } catch (error) {
    console.error('儲存警告資料失敗:', error);
  }
}

function saveMarriages() {
  try {
    fs.writeFileSync('./marriages.json', JSON.stringify(marriageData, null, 2));
  } catch (error) {
    console.error('儲存結婚資料失敗:', error);
  }
}

function saveProposals() {
  try {
    fs.writeFileSync('./proposals.json', JSON.stringify(proposalData, null, 2));
    console.log(
      '求婚資料已成功儲存, 資料數量:',
      Object.keys(proposalData).length
    );
  } catch (error) {
    console.error('儲存求婚資料失敗:', error);
  }
}

// 新增：儲存離婚申請資料
function saveDivorces() {
  try {
    fs.writeFileSync('./divorces.json', JSON.stringify(divorceData, null, 2));
    console.log(
      '離婚資料已成功儲存, 資料數量:',
      Object.keys(divorceData).length
    );
  } catch (error) {
    console.error('儲存離婚資料失敗:', error);
  }
}

function saveMutedMembers() {
  try {
    fs.writeFileSync(
      './muted_members.json',
      JSON.stringify(mutedMembers, null, 2)
    );
  } catch (error) {
    console.error('儲存禁言資料失敗:', error);
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
  const expiredTime = 30 * 60 * 1000; // 30分鐘

  for (const proposalId in proposalData) {
    const proposal = proposalData[proposalId];
    if (now - proposal.timestamp > expiredTime) {
      delete proposalData[proposalId];
      console.log(`求婚 ${proposalId} 已過期並被清理`);
    }
  }
  saveProposals();
}

// 新增：清理過期離婚申請
function cleanExpiredDivorces() {
  const now = Date.now();
  const expiredTime = 30 * 60 * 1000; // 30分鐘

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
                .setColor('#32CD32')
                .setTitle('🔊 禁言時間已到期')
                .setDescription(`你在 **${guild.name}** 伺服器的禁言時間已結束`)
                .addFields(
                  { name: '原禁言原因', value: muteData.reason },
                  { name: '禁言時長', value: `${muteData.duration}分鐘` },
                  {
                    name: '解除時間',
                    value: new Date().toLocaleString('zh-TW'),
                  }
                )
                .setFooter({ text: '歡迎回來！請繼續遵守伺服器規則～' });

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
      .setColor('#FF6B6B')
      .setTitle('⚠️ 警告通知')
      .setDescription(`你在 **${guild.name}** 伺服器中收到了一個警告！！`)
      .addFields(
        { name: '警告原因', value: reason },
        { name: '執行管理員', value: moderator.displayName },
        { name: '當前警告次數', value: `${userData.count}次` },
        { name: '時間', value: new Date().toLocaleString('zh-TW') }
      )
      .setFooter({ text: '請遵守伺服器規則，避免進一步的處罰！霸脫霸脫～' });

    await user.send({ embeds: [dmEmbed] });
    console.log(`已成功向 ${user.tag} 發送警告通知`);
  } catch (error) {
    console.log(`無法向 ${user.tag} 發送私訊:`, error.message);
  }

  // 檢查是否需要自動處罰
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
    console.error('執行自動懲處時出錯:', error);
  }
}

// 處理按鈕互動
async function handleButtonInteraction(interaction) {
  const customId = interaction.customId;
  console.log('收到按鈕點擊，customId:', customId);

  // 檢查是否為求婚按鈕
  if (customId.startsWith('accept_') || customId.startsWith('reject_')) {
    await handleProposalButtons(interaction, customId);
    return;
  }

  // 檢查是否為離婚按鈕
  if (
    customId.startsWith('divorce_accept_') ||
    customId.startsWith('divorce_reject_')
  ) {
    await handleDivorceButtons(interaction, customId);
    return;
  }

  console.log('未知的按鈕類型，忽略');
}

// 處理求婚按鈕
async function handleProposalButtons(interaction, customId) {
  let action, proposalId;

  if (customId.startsWith('accept_')) {
    action = 'accept';
    proposalId = customId.substring(7);
  } else if (customId.startsWith('reject_')) {
    action = 'reject';
    proposalId = customId.substring(7);
  }

  console.log('解析結果:', { action, proposalId });

  const proposal = proposalData[proposalId];
  if (!proposal) {
    console.log(`找不到求婚資料，proposalId: ${proposalId}`);
    await interaction.reply({
      content: '❌ 這個求婚已經過期或不存在！',
      flags: 64,
    });
    return;
  }

  // 檢查是否為被求婚者
  if (interaction.user.id !== proposal.target) {
    await interaction.reply({
      content: '❌ 這不是對你的求婚！',
      flags: 64,
    });
    return;
  }

  if (action === 'accept') {
    await handleAcceptProposal(interaction, proposalId, proposal);
  } else {
    await handleRejectProposal(interaction, proposalId, proposal);
  }
}

// 新增：處理離婚按鈕
async function handleDivorceButtons(interaction, customId) {
  let action, divorceId;

  if (customId.startsWith('divorce_accept_')) {
    action = 'accept';
    divorceId = customId.substring(15);
  } else if (customId.startsWith('divorce_reject_')) {
    action = 'reject';
    divorceId = customId.substring(15);
  }

  console.log('離婚按鈕解析結果:', { action, divorceId });

  const divorce = divorceData[divorceId];
  if (!divorce) {
    await interaction.reply({
      content: '❌ 這個離婚申請已經過期或不存在！',
      flags: 64,
    });
    return;
  }

  // 檢查是否為被申請離婚的配偶
  if (interaction.user.id !== divorce.spouse) {
    await interaction.reply({
      content: '❌ 這不是對你的離婚申請！',
      flags: 64,
    });
    return;
  }

  if (action === 'accept') {
    await handleAcceptDivorce(interaction, divorceId, divorce);
  } else {
    await handleRejectDivorce(interaction, divorceId, divorce);
  }
}

// 求婚指令處理
async function handleProposeCommand(interaction) {
  const proposer = interaction.user;
  const target = interaction.options.getUser('user');

  // 檢查是否對自己求婚
  if (proposer.id === target.id) {
    await interaction.reply({
      content: '❌ 你不能對自己求婚啦！',
      flags: 64,
    });
    return;
  }

  // 檢查求婚者是否已結婚
  if (isMarried(proposer.id)) {
    const spouseData = marriageData[proposer.id];
    const spouse = await interaction.guild.members.fetch(spouseData.spouse);
    await interaction.reply({
      content: `❌ 你已經和 ${spouse.displayName} 結婚了！不能腳踏兩條船哦～`,
      flags: 64,
    });
    return;
  }

  // 檢查目標是否已結婚
  if (isMarried(target.id)) {
    const spouseData = marriageData[target.id];
    const spouse = await interaction.guild.members.fetch(spouseData.spouse);
    await interaction.reply({
      content: `❌ ${target.displayName} 已經和 ${spouse.displayName} 結婚了！`,
      flags: 64,
    });
    return;
  }

  // 檢查是否有待處理的求婚
  const existingProposal = Object.values(proposalData).find(
    (p) => p.proposer === proposer.id || p.target === target.id
  );

  if (existingProposal) {
    await interaction.reply({
      content: '❌ 你們其中一人已經有待處理的求婚了！請先處理完畢。',
      flags: 64,
    });
    return;
  }

  // 建立求婚記錄
  const proposalId = `${proposer.id}_${target.id}_${Date.now()}`;
  proposalData[proposalId] = {
    proposer: proposer.id,
    target: target.id,
    timestamp: Date.now(),
    guildId: interaction.guild.id,
  };

  console.log('建立新求婚:', {
    proposalId,
    proposer: proposer.id,
    target: target.id,
  });
  saveProposals();

  // 建立按鈕
  const acceptButton = new ButtonBuilder()
    .setCustomId(`accept_${proposalId}`)
    .setLabel('💍 接受')
    .setStyle(ButtonStyle.Success);

  const rejectButton = new ButtonBuilder()
    .setCustomId(`reject_${proposalId}`)
    .setLabel('💔 拒絕')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(acceptButton, rejectButton);

  // 建立求婚嵌入訊息
  const proposalEmbed = new EmbedBuilder()
    .setColor('#FF69B4')
    .setTitle('💍 求婚通知')
    .setDescription(`${proposer} 向 ${target} 求婚！`)
    .addFields(
      { name: '💕 求婚訊息', value: `${target}，你願意和我結婚嗎？` },
      { name: '⏰ 有效時間', value: '30分鐘' },
      { name: '📝 如何回應', value: '點擊下方按鈕回應' }
    )
    .setThumbnail(proposer.displayAvatarURL())
    .setTimestamp();

  await interaction.reply({
    embeds: [proposalEmbed],
    components: [row],
  });

  // 發送私訊給被求婚者
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor('#FF69B4')
      .setTitle('💍 有人向你求婚了！')
      .setDescription(
        `在 **${interaction.guild.name}** 伺服器中，${proposer.displayName} 向你求婚了！`
      )
      .addFields(
        { name: '回應方式', value: '請到伺服器點擊按鈕回應' },
        { name: '有效時間', value: '30分鐘內有效' }
      )
      .setThumbnail(proposer.displayAvatarURL())
      .setTimestamp();

    await target.send({ embeds: [dmEmbed] });
  } catch (error) {
    console.log(`無法向 ${target.tag} 發送求婚私訊:`, error.message);
  }
}

// 處理接受求婚
async function handleAcceptProposal(interaction, proposalId, proposal) {
  console.log('處理接受求婚:', { proposalId, proposal });

  try {
    const proposer = await interaction.guild.members.fetch(proposal.proposer);
    const target = interaction.user;

    // 檢查雙方是否仍然單身
    if (isMarried(proposal.proposer) || isMarried(proposal.target)) {
      delete proposalData[proposalId];
      saveProposals();
      await interaction.update({
        content: '❌ 求婚已失效，因為其中一方已經結婚了！',
        embeds: [],
        components: [],
      });
      return;
    }

    // 建立結婚關係
    createMarriage(proposal.proposer, proposal.target);

    // 刪除求婚記錄
    delete proposalData[proposalId];
    saveProposals();

    // 建立結婚公告
    const marriageEmbed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('🎉 結婚公告')
      .setDescription(`恭喜 ${proposer} 和 ${target} 結為夫妻！`)
      .addFields(
        { name: '💒 結婚日期', value: new Date().toLocaleString('zh-TW') },
        { name: '💝 祝福', value: '祝你們百年好合，永浴愛河！' }
      )
      .setTimestamp();

    await interaction.update({
      embeds: [marriageEmbed],
      components: [],
    });
  } catch (error) {
    console.error('處理接受求婚時出錯:', error);
    await interaction.reply({
      content: '❌ 處理求婚時發生錯誤！',
      flags: 64,
    });
  }
}

// 處理拒絕求婚
async function handleRejectProposal(interaction, proposalId, proposal) {
  console.log('處理拒絕求婚:', { proposalId, proposal });

  try {
    const proposer = await interaction.guild.members.fetch(proposal.proposer);
    const target = interaction.user;

    // 刪除求婚記錄
    delete proposalData[proposalId];
    saveProposals();

    const rejectEmbed = new EmbedBuilder()
      .setColor('#FF6B6B')
      .setTitle('💔 求婚被拒絕')
      .setDescription(`${target} 拒絕了 ${proposer} 的求婚。`)
      .addFields(
        { name: '😢 結果', value: '很遺憾，這次求婚沒有成功...' },
        { name: '💪 鼓勵', value: '不要氣餒，緣分會到的！' }
      )
      .setTimestamp();

    await interaction.update({
      embeds: [rejectEmbed],
      components: [],
    });
  } catch (error) {
    console.error('處理拒絕求婚時出錯:', error);
    await interaction.reply({
      content: '❌ 處理求婚時發生錯誤！',
      flags: 64,
    });
  }
}

// 查看婚姻狀態指令處理
async function handleMarriageCommand(interaction) {
  const targetUser = interaction.options.getUser('user') || interaction.user;

  if (!isMarried(targetUser.id)) {
    const singleEmbed = new EmbedBuilder()
      .setColor('#808080')
      .setTitle('💔 單身狀態')
      .setDescription(
        targetUser.id === interaction.user.id
          ? '你是單身狗 🐕'
          : `${targetUser.displayName} 是單身狗 🐕`
      )
      .addFields({ name: '建議', value: '要不要試試使用 `/propose` 找個伴？' })
      .setTimestamp();

    await interaction.reply({ embeds: [singleEmbed], flags: 64 });
    return;
  }

  const spouseData = marriageData[targetUser.id];
  const spouse = await interaction.guild.members.fetch(spouseData.spouse);
  const marriageDate = new Date(spouseData.marriageDate);
  const daysTogether = Math.floor(
    (Date.now() - marriageDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const marriageEmbed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('💕 婚姻狀態')
    .setDescription(
      targetUser.id === interaction.user.id
        ? `你和 ${spouse.displayName} 已結婚`
        : `${targetUser.displayName} 和 ${spouse.displayName} 已結婚`
    )
    .addFields(
      {
        name: '💒 結婚日期',
        value: marriageDate.toLocaleString('zh-TW'),
        inline: true,
      },
      { name: '📅 相伴天數', value: `${daysTogether} 天`, inline: true },
      { name: '💝 祝福', value: '願你們永遠幸福美滿！' }
    )
    .setThumbnail(spouse.displayAvatarURL())
    .setTimestamp();

  await interaction.reply({ embeds: [marriageEmbed], flags: 64 });
}

// 修正後的離婚指令處理 - 需要雙方同意
async function handleDivorceCommand(interaction) {
  const user = interaction.user;

  if (!isMarried(user.id)) {
    await interaction.reply({
      content: '❌ 你還沒有結婚，無法離婚！',
      flags: 64,
    });
    return;
  }

  const spouseData = marriageData[user.id];
  const spouse = await interaction.guild.members.fetch(spouseData.spouse);

  // 檢查是否已有待處理的離婚申請
  const existingDivorce = Object.values(divorceData).find(
    (d) => d.applicant === user.id || d.spouse === spouseData.spouse
  );

  if (existingDivorce) {
    await interaction.reply({
      content: '❌ 已經有待處理的離婚申請了！請先等待回應。',
      flags: 64,
    });
    return;
  }

  // 建立離婚申請記錄
  const divorceId = `${user.id}_${spouseData.spouse}_${Date.now()}`;
  divorceData[divorceId] = {
    applicant: user.id,
    spouse: spouseData.spouse,
    timestamp: Date.now(),
    guildId: interaction.guild.id,
  };

  console.log('建立新離婚申請:', {
    divorceId,
    applicant: user.id,
    spouse: spouseData.spouse,
  });
  saveDivorces();

  // 建立按鈕
  const acceptButton = new ButtonBuilder()
    .setCustomId(`divorce_accept_${divorceId}`)
    .setLabel('💔 同意離婚')
    .setStyle(ButtonStyle.Danger);

  const rejectButton = new ButtonBuilder()
    .setCustomId(`divorce_reject_${divorceId}`)
    .setLabel('💕 拒絕離婚')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(acceptButton, rejectButton);

  const marriageDate = new Date(spouseData.marriageDate);
  const daysTogether = Math.floor(
    (Date.now() - marriageDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // 建立離婚申請嵌入訊息
  const divorceEmbed = new EmbedBuilder()
    .setColor('#8B4513')
    .setTitle('💔 離婚申請')
    .setDescription(`${user} 向 ${spouse} 提出離婚申請`)
    .addFields(
      { name: '💒 結婚日期', value: marriageDate.toLocaleString('zh-TW') },
      { name: '📅 相伴天數', value: `${daysTogether} 天` },
      { name: '⏰ 有效時間', value: '30分鐘' },
      { name: '📝 如何回應', value: '請配偶點擊下方按鈕回應' }
    )
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();

  await interaction.reply({
    embeds: [divorceEmbed],
    components: [row],
  });

  // 發送私訊給配偶
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor('#8B4513')
      .setTitle('💔 離婚申請通知')
      .setDescription(
        `在 **${interaction.guild.name}** 伺服器中，${user.displayName} 向你提出了離婚申請。`
      )
      .addFields(
        { name: '回應方式', value: '請到伺服器點擊按鈕回應' },
        { name: '有效時間', value: '30分鐘內有效' },
        { name: '💭 提醒', value: '這是一個重要的決定，請仔細考慮。' }
      )
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp();

    await spouse.send({ embeds: [dmEmbed] });
  } catch (error) {
    console.log(`無法向 ${spouse.user.tag} 發送離婚申請私訊:`, error.message);
  }
}

// 新增：處理同意離婚
async function handleAcceptDivorce(interaction, divorceId, divorce) {
  console.log('處理同意離婚:', { divorceId, divorce });

  try {
    const applicant = await interaction.guild.members.fetch(divorce.applicant);
    const spouse = interaction.user;

    // 檢查雙方是否仍然結婚
    if (!isMarried(divorce.applicant) || !isMarried(divorce.spouse)) {
      delete divorceData[divorceId];
      saveDivorces();
      await interaction.update({
        content: '❌ 離婚申請已失效，因為其中一方已經不是夫妻關係了！',
        embeds: [],
        components: [],
      });
      return;
    }

    const marriageDate = new Date(marriageData[divorce.applicant].marriageDate);
    const daysTogether = Math.floor(
      (Date.now() - marriageDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 刪除結婚關係
    deleteMarriage(divorce.applicant, divorce.spouse);

    // 刪除離婚申請記錄
    delete divorceData[divorceId];
    saveDivorces();

    const divorceEmbed = new EmbedBuilder()
      .setColor('#8B4513')
      .setTitle('📋 離婚證明')
      .setDescription(`${applicant} 和 ${spouse} 已經離婚`)
      .addFields(
        { name: '💔 結束日期', value: new Date().toLocaleString('zh-TW') },
        { name: '⏰ 婚姻持續', value: `${daysTogether} 天` },
        { name: '🕊️ 祝福', value: '祝你們各自都能找到新的幸福！' }
      )
      .setTimestamp();

    await interaction.update({
      embeds: [divorceEmbed],
      components: [],
    });

    // 發送私訊給申請者
    try {
      const applicantDM = new EmbedBuilder()
        .setColor('#8B4513')
        .setTitle('💔 離婚申請已通過')
        .setDescription(
          `${spouse.displayName} 在 **${interaction.guild.name}** 伺服器同意了你的離婚申請。`
        )
        .addFields(
          { name: '狀態', value: '你們現在都恢復單身了' },
          { name: '祝福', value: '希望你能找到新的幸福！' }
        )
        .setTimestamp();

      await applicant.send({ embeds: [applicantDM] });
    } catch (error) {
      console.log(
        `無法向 ${applicant.user.tag} 發送離婚通過通知:`,
        error.message
      );
    }
  } catch (error) {
    console.error('處理同意離婚時出錯:', error);
    await interaction.reply({
      content: '❌ 處理離婚時發生錯誤！',
      flags: 64,
    });
  }
}

// 新增：處理拒絕離婚
async function handleRejectDivorce(interaction, divorceId, divorce) {
  console.log('處理拒絕離婚:', { divorceId, divorce });

  try {
    const applicant = await interaction.guild.members.fetch(divorce.applicant);
    const spouse = interaction.user;

    // 刪除離婚申請記錄
    delete divorceData[divorceId];
    saveDivorces();

    const rejectEmbed = new EmbedBuilder()
      .setColor('#32CD32')
      .setTitle('💕 離婚申請被拒絕')
      .setDescription(`${spouse} 拒絕了 ${applicant} 的離婚申請。`)
      .addFields(
        { name: '💑 結果', value: '你們仍然是夫妻關係' },
        { name: '💝 建議', value: '或許可以嘗試溝通解決問題，而不是離婚。' }
      )
      .setTimestamp();

    await interaction.update({
      embeds: [rejectEmbed],
      components: [],
    });

    // 發送私訊給申請者
    try {
      const applicantDM = new EmbedBuilder()
        .setColor('#32CD32')
        .setTitle('💕 離婚申請被拒絕')
        .setDescription(
          `${spouse.displayName} 在 **${interaction.guild.name}** 伺服器拒絕了你的離婚申請。`
        )
        .addFields(
          { name: '狀態', value: '你們仍然保持夫妻關係' },
          { name: '建議', value: '或許可以嘗試溝通，一起解決問題。' }
        )
        .setTimestamp();

      await applicant.send({ embeds: [applicantDM] });
    } catch (error) {
      console.log(
        `無法向 ${applicant.user.tag} 發送離婚拒絕通知:`,
        error.message
      );
    }
  } catch (error) {
    console.error('處理拒絕離婚時出錯:', error);
    await interaction.reply({
      content: '❌ 處理離婚時發生錯誤！',
      flags: 64,
    });
  }
}

// 建立斜杠指令
const commands = [
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('警告成員')
    .addUserOption((option) =>
      option.setName('user').setDescription('要警告的成員').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('警告原因').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('check_warn')
    .setDescription('查看成員警告紀錄')
    .addUserOption((option) =>
      option.setName('user').setDescription('要查看的成員').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('delete_warn')
    .setDescription('刪除成員的一個警告')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('要刪除警告的成員')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('warn_id').setDescription('警告ID').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('clear_all_warn')
    .setDescription('清除成員所有的警告')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('要清除警告的成員')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('踢出成員')
    .addUserOption((option) =>
      option.setName('user').setDescription('要踢出的成員').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('踢出原因').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('封鎖成員')
    .addUserOption((option) =>
      option.setName('user').setDescription('要封鎖的成員').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('封鎖原因').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('禁言成員')
    .addUserOption((option) =>
      option.setName('user').setDescription('要禁言的成員').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('mute_duration')
        .setDescription('禁言時長(分鐘)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('禁言原因').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('解除成員禁言')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('要解除禁言的成員')
        .setRequired(true)
    ),

  // 結婚系統指令
  new SlashCommandBuilder()
    .setName('propose')
    .setDescription('向某個成員求婚')
    .addUserOption((option) =>
      option.setName('user').setDescription('要求婚的成員').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('marriage')
    .setDescription('查看婚姻狀態')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('要查看的成員（不填則查看自己）')
        .setRequired(false)
    ),

  new SlashCommandBuilder().setName('divorce').setDescription('申請離婚'),
];

// 註冊斜杠指令
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    console.log('開始註冊斜杠指令...');
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log('斜杠指令註冊成功!');
  } catch (error) {
    console.error('註冊斜杠指令失敗:', error);
  }
}

// 機器人就緒事件
client.once('ready', async () => {
  console.log(`機器人已登入: ${client.user.tag}`);

  // 載入所有資料
  loadWarnings();
  loadMarriages();
  loadProposals();
  loadDivorces(); // 新增：載入離婚資料
  loadMutedMembers();
  await registerCommands();

  console.log('✅ 所有系統已載入完成');

  // 每10分鐘清理過期的求婚和離婚申請
  setInterval(() => {
    cleanExpiredProposals();
    cleanExpiredDivorces(); // 新增：清理過期離婚申請
  }, 10 * 60 * 1000);

  // 每1分鐘檢查禁言到期
  setInterval(checkMutedMembers, 1 * 60 * 1000);
});

// 處理斜杠指令互動
client.on('interactionCreate', async (interaction) => {
  // 處理按鈕互動
  if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const { commandName } = interaction;

  // 結婚系統指令不需要管理員權限
  const marriageCommands = ['propose', 'marriage', 'divorce'];

  if (!marriageCommands.includes(commandName)) {
    // 檢查權限 - 只有管理員可以使用管理指令
    if (!isAdmin(member)) {
      await interaction.reply({
        content: '❌ 你沒有權限使用此指令！',
        flags: 64, // ephemeral flag
      });
      return;
    }
  }

  try {
    switch (commandName) {
      // 管理指令
      case 'warn':
        await handleWarnCommand(interaction);
        break;
      case 'check_warn':
        await handleCheckWarnCommand(interaction);
        break;
      case 'delete_warn':
        await handleDeleteWarnCommand(interaction);
        break;
      case 'clear_all_warn':
        await handleClearAllWarnCommand(interaction);
        break;
      case 'kick':
        await handleKickCommand(interaction);
        break;
      case 'ban':
        await handleBanCommand(interaction);
        break;
      case 'mute':
        await handleMuteCommand(interaction);
        break;
      case 'unmute':
        await handleUnmuteCommand(interaction);
        break;

      // 結婚系統指令
      case 'propose':
        await handleProposeCommand(interaction);
        break;
      case 'marriage':
        await handleMarriageCommand(interaction);
        break;
      case 'divorce':
        await handleDivorceCommand(interaction);
        break;
    }
  } catch (error) {
    console.error('處理指令時出錯:', error);
    const isReplied = interaction.replied || interaction.deferred;
    if (!isReplied) {
      await interaction.reply({
        content: '❌ 執行指令時發生錯誤！',
        flags: 64, // ephemeral flag
      });
    }
  }
});

// 警告指令處理
async function handleWarnCommand(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const moderator = interaction.member;

  const warning = await addWarning(user, moderator, reason, interaction.guild);
  const userData = getUserWarnings(user.id);

  const embed = new EmbedBuilder()
    .setColor('#FF6B6B')
    .setTitle('⚠️ 成員已被警告')
    .addFields(
      { name: '成員', value: `${user}`, inline: true },
      { name: '管理員', value: `${moderator}`, inline: true },
      { name: '原因', value: reason },
      { name: '警告次數', value: `${userData.count}次`, inline: true },
      { name: '警告ID', value: `${warning.id}`, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// 查看警告指令處理
async function handleCheckWarnCommand(interaction) {
  const user = interaction.options.getUser('user');
  const userData = getUserWarnings(user.id);

  if (userData.count === 0) {
    await interaction.reply({
      content: `📋 ${user.tag} 沒有任何警告紀錄。`,
      flags: 64, // ephemeral flag
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#FFA500')
    .setTitle(`📋 ${user.tag} 的警告紀錄`)
    .setDescription(`總警告次數: ${userData.count}`)
    .setThumbnail(user.displayAvatarURL());

  userData.warnings.slice(-5).forEach((warning, index) => {
    const moderator = interaction.guild.members.cache.get(warning.moderator);
    embed.addFields({
      name: `警告 #${warning.id}`,
      value: `**原因:** ${warning.reason}\n**管理員:** ${
        moderator ? moderator.displayName : '未知'
      }\n**時間:** ${new Date(warning.timestamp).toLocaleString('zh-TW')}`,
      inline: false,
    });
  });

  if (userData.warnings.length > 5) {
    embed.setFooter({
      text: `顯示最近五條警告，共${userData.warnings.length}條`,
    });
  }

  await interaction.reply({ embeds: [embed], flags: 64 }); // ephemeral flag
}

// 修正後的刪除警告指令處理 - 加強錯誤處理和私訊通知
async function handleDeleteWarnCommand(interaction) {
  const user = interaction.options.getUser('user');
  const warningId = interaction.options.getInteger('warn_id');
  const userData = getUserWarnings(user.id);

  const warningIndex = userData.warnings.findIndex((w) => w.id === warningId);

  if (warningIndex === -1) {
    await interaction.reply({
      content:
        '❌ 找不到指定的警告ID！請使用 `/check_warn` 指令查看正確的警告ID。',
      flags: 64, // ephemeral flag
    });
    return;
  }

  const deletedWarning = userData.warnings[warningIndex];
  userData.warnings.splice(warningIndex, 1);
  userData.count = userData.warnings.length;
  saveWarnings();

  console.log(
    `管理員 ${interaction.member.displayName} 刪除了 ${user.tag} 的警告 #${warningId}`
  );

  // 發送私訊通知成員警告被刪除
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor('#32CD32')
      .setTitle('✅ 警告已被撤銷')
      .setDescription(
        `你在 **${interaction.guild.name}** 伺服器中的一個警告已被撤銷`
      )
      .addFields(
        { name: '原警告原因', value: deletedWarning.reason },
        { name: '撤銷管理員', value: interaction.member.displayName },
        { name: '當前警告次數', value: `${userData.count}次` },
        { name: '時間', value: new Date().toLocaleString('zh-TW') }
      )
      .setFooter({ text: '恭喜！你的警告次數減少了～' });

    await user.send({ embeds: [dmEmbed] });
    console.log(`已成功向 ${user.tag} 發送警告撤銷通知`);

    await interaction.reply({
      content: `✅ 已刪除 ${user.tag} 的警告 #${warningId}，並已通知成員`,
      flags: 64, // ephemeral flag
    });
  } catch (error) {
    console.log(`無法向 ${user.tag} 發送警告撤銷私訊:`, error.message);

    await interaction.reply({
      content: `✅ 已刪除 ${user.tag} 的警告 #${warningId}（但無法發送私訊通知給該成員）`,
      flags: 64, // ephemeral flag
    });
  }
}

// 修正後的清除所有警告指令處理 - 加強錯誤處理和私訊通知
async function handleClearAllWarnCommand(interaction) {
  const user = interaction.options.getUser('user');
  const userData = getUserWarnings(user.id);

  if (userData.count === 0) {
    await interaction.reply({
      content: `📋 ${user.tag} 沒有任何警告紀錄需要清除。`,
      flags: 64, // ephemeral flag
    });
    return;
  }

  const originalCount = userData.count;

  // 刪除用戶的警告資料
  delete warningsData[user.id];
  saveWarnings();

  console.log(
    `管理員 ${interaction.member.displayName} 清除了 ${user.tag} 的所有警告 (共${originalCount}條)`
  );

  // 發送私訊通知成員所有警告被清除
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('🎉 所有警告已被清除')
      .setDescription(
        `你在 **${interaction.guild.name}** 伺服器中的所有警告已被清除！`
      )
      .addFields(
        { name: '清除的警告數量', value: `${originalCount}次` },
        { name: '執行管理員', value: interaction.member.displayName },
        { name: '當前警告次數', value: '0次' },
        { name: '時間', value: new Date().toLocaleString('zh-TW') }
      )
      .setFooter({ text: '恭喜！你重新獲得了清白之身～記得遵守規則哦！' });

    await user.send({ embeds: [dmEmbed] });
    console.log(`已成功向 ${user.tag} 發送警告清除通知`);

    await interaction.reply({
      content: `✅ 已清除 ${user.tag} 的所有警告紀錄！（共清除了 ${originalCount} 條警告），並已通知成員`,
      flags: 64, // ephemeral flag
    });
  } catch (error) {
    console.log(`無法向 ${user.tag} 發送警告清除私訊:`, error.message);

    await interaction.reply({
      content: `✅ 已清除 ${user.tag} 的所有警告紀錄！（共清除了 ${originalCount} 條警告）（但無法發送私訊通知給該成員）`,
      flags: 64, // ephemeral flag
    });
  }
}

// 踢出指令處理
async function handleKickCommand(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || '未提供原因';
  const member = interaction.guild.members.cache.get(user.id);

  if (!member) {
    await interaction.reply({
      content: '❌ 成員不在伺服器中！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({
      content: '❌ 無法踢出此成員！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  try {
    // 先發送私訊通知，再踢出
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#FF8C00')
        .setTitle('👢 你已被踢出伺服器')
        .setDescription(`你已被從 **${interaction.guild.name}** 伺服器踢出`)
        .addFields(
          { name: '踢出原因', value: reason },
          { name: '執行管理員', value: interaction.member.displayName },
          { name: '時間', value: new Date().toLocaleString('zh-TW') }
        )
        .setFooter({ text: '你可以重新加入伺服器，但請遵守規則！' });

      await user.send({ embeds: [dmEmbed] });
      console.log(`已成功向 ${user.tag} 發送踢出通知`);
    } catch (error) {
      console.log(`無法向 ${user.tag} 發送踢出通知私訊:`, error.message);
    }

    await member.kick(reason);

    const embed = new EmbedBuilder()
      .setColor('#FF8C00')
      .setTitle('👢 成員已被踢出')
      .addFields(
        { name: '成員', value: `${user.tag}`, inline: true },
        { name: '管理員', value: `${interaction.member}`, inline: true },
        { name: '原因', value: reason }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('踢出成員時出錯:', error);
    await interaction.reply({
      content: '❌ 踢出成員時發生錯誤！請檢查機器人權限。',
      flags: 64, // ephemeral flag
    });
  }
}

// 封鎖指令處理
async function handleBanCommand(interaction) {
  const user = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || '未提供原因';
  const member = interaction.guild.members.cache.get(user.id);

  if (member && !member.bannable) {
    await interaction.reply({
      content: '❌ 無法封鎖此成員！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  try {
    // 先發送私訊通知，再封鎖
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#DC143C')
        .setTitle('🔨 你已被封鎖')
        .setDescription(`你已被從 **${interaction.guild.name}** 伺服器封鎖`)
        .addFields(
          { name: '封鎖原因', value: reason },
          { name: '執行管理員', value: interaction.member.displayName },
          { name: '時間', value: new Date().toLocaleString('zh-TW') }
        )
        .setFooter({ text: '如有異議，請聯繫伺服器管理員申訴。' });

      await user.send({ embeds: [dmEmbed] });
      console.log(`已成功向 ${user.tag} 發送封鎖通知`);
    } catch (error) {
      console.log(`無法向 ${user.tag} 發送封鎖通知私訊:`, error.message);
    }

    await interaction.guild.members.ban(user, { reason });

    const embed = new EmbedBuilder()
      .setColor('#DC143C')
      .setTitle('🔨 成員已被封鎖')
      .addFields(
        { name: '成員', value: `${user.tag}`, inline: true },
        { name: '管理員', value: `${interaction.member}`, inline: true },
        { name: '原因', value: reason }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('封鎖成員時出錯:', error);
    await interaction.reply({
      content: '❌ 封鎖成員時發生錯誤！請檢查機器人權限。',
      flags: 64, // ephemeral flag
    });
  }
}

// 禁言指令處理
async function handleMuteCommand(interaction) {
  const user = interaction.options.getUser('user');
  const duration = interaction.options.getInteger('mute_duration');
  const reason = interaction.options.getString('reason') || '未提供原因';
  const member = interaction.guild.members.cache.get(user.id);

  if (!member) {
    await interaction.reply({
      content: '❌ 成員不在伺服器中！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  if (!member.moderatable) {
    await interaction.reply({
      content: '❌ 無法禁言此成員！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  // 驗證禁言時長
  if (duration <= 0) {
    await interaction.reply({
      content: '❌ 禁言時長必須大於0分鐘！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  if (duration > 40320) {
    // 28天 = 40320分鐘
    await interaction.reply({
      content: '❌ 禁言時間不能超過28天(40320分鐘)！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  try {
    const timeoutDuration = duration * 60 * 1000; // 轉換為毫秒
    const unmuteTime = Date.now() + timeoutDuration;

    // 記錄禁言資訊
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

    // 發送私訊通知被禁言者
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#9932CC')
        .setTitle('🔇 你已被禁言')
        .setDescription(`你在 **${interaction.guild.name}** 伺服器中被禁言了`)
        .addFields(
          { name: '禁言原因', value: reason },
          { name: '禁言時長', value: `${duration}分鐘` },
          { name: '執行管理員', value: interaction.member.displayName },
          {
            name: '解除時間',
            value: new Date(unmuteTime).toLocaleString('zh-TW'),
          }
        )
        .setFooter({ text: '禁言期間請反思自己的行為，時間到會自動解除。' });

      await user.send({ embeds: [dmEmbed] });
      console.log(`已成功向 ${user.tag} 發送禁言通知`);
    } catch (error) {
      console.log(`無法向 ${user.tag} 發送禁言通知私訊:`, error.message);
    }

    const embed = new EmbedBuilder()
      .setColor('#9932CC')
      .setTitle('🔇 成員已被禁言')
      .addFields(
        { name: '成員', value: `${user.tag}`, inline: true },
        { name: '管理員', value: `${interaction.member}`, inline: true },
        { name: '時長', value: `${duration}分鐘`, inline: true },
        { name: '原因', value: reason }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('禁言成員時出錯:', error);
    await interaction.reply({
      content: '❌ 禁言成員時發生錯誤！請檢查機器人權限。',
      flags: 64, // ephemeral flag
    });
  }
}

// 解除禁言指令處理
async function handleUnmuteCommand(interaction) {
  const user = interaction.options.getUser('user');
  const member = interaction.guild.members.cache.get(user.id);

  if (!member) {
    await interaction.reply({
      content: '❌ 成員不在伺服器中！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  if (!member.isCommunicationDisabled()) {
    await interaction.reply({
      content: '❌ 此成員沒有被禁言！',
      flags: 64, // ephemeral flag
    });
    return;
  }

  try {
    await member.timeout(null);

    // 移除禁言記錄
    if (mutedMembers[user.id]) {
      delete mutedMembers[user.id];
      saveMutedMembers();
    }

    // 發送私訊通知
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#32CD32')
        .setTitle('🔊 禁言已被解除')
        .setDescription(
          `你在 **${interaction.guild.name}** 伺服器的禁言已被管理員解除`
        )
        .addFields(
          { name: '執行管理員', value: interaction.member.displayName },
          { name: '解除時間', value: new Date().toLocaleString('zh-TW') }
        )
        .setFooter({ text: '請繼續遵守伺服器規則！' });

      await user.send({ embeds: [dmEmbed] });
      console.log(`已成功向 ${user.tag} 發送解除禁言通知`);
    } catch (error) {
      console.log(`無法向 ${user.tag} 發送解除禁言通知:`, error.message);
    }

    const embed = new EmbedBuilder()
      .setColor('#32CD32')
      .setTitle('🔊 成員禁言已解除')
      .addFields(
        { name: '成員', value: `${user.tag}`, inline: true },
        { name: '管理員', value: `${interaction.member}`, inline: true }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('解除禁言時出錯:', error);
    await interaction.reply({
      content: '❌ 解除禁言時發生錯誤！請檢查機器人權限。',
      flags: 64, // ephemeral flag
    });
  }
}

// 啟動機器人
client.login(config.token);
