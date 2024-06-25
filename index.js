const puppeteer = require("puppeteer");
const sharp = require("sharp");
const fsExtra = require("fs-extra");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const args = process.argv; // 第一个（node的路径）和第二个（app.js的路径） 第三个 自定义内容

const outputPath = args[2]; // npm run start 输出路径：参数
console.log("输出路径为", outputPath);

// 输入单词列表
const content = `shore 海岸
bubble 气泡
drone 无人机
ambulance 救护车
reward 回报，奖励
chicks 小鸡，幼鸟
diversity  多样性
fin 鳍
pressure 压力
trail 痕迹，小路
collector 收集者
singing 歌唱
wind 风
tradition 习俗
bitter 苦的
farmer 农民
skin 皮肤
invent 发明
imported 进口的
different 不同
traveling 旅行 
husband 丈夫
writer 作家
fog 雾
publicity 宣传，广告
balance 平衡
pot 罐子
garbage 垃圾
straw 稻草
dream 梦
boxing 拳击
meaning 意思
pair 一对
broken 损坏的
definition 定义
shiver 颤抖
friendships 友谊
outcome 结果
bees 蜜蜂
ports 港口
poison 毒药
illegal 违法的
salty 咸的
lizard 蜥蜴`;

const lines = content.split("\n");
const words = lines.map((line) => {
  let parts = line.split(" ");
  let zh = parts.pop();
  let en = parts.join(" ");
  return {
    zh,
    en,
  };
});

async function managePath(targetPath) {
  try {
    if (await fsExtra.pathExists(targetPath)) {
      //若路径存在则删除路径下所有内容
      await fsExtra.emptyDir(targetPath);
      console.log(`Emptied directory: ${targetPath}`);
    } else {
      //若路径不存在则创建
      await fsExtra.ensureDir(targetPath);
      console.log(`Created directory: ${targetPath}`);
    }
  } catch (error) {
    console.error(`Error managing path: ${error}`);
  }
}

// 爬取有道词典网页并获取音频URL
async function fetchAudioUrl(word) {
  const url = `https://www.youdao.com/result?word=${word}&lang=en`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  let audioUrl = null;
  // 监听所有网络请求
  page.on("response", async (response) => {
    const request = response.request();
    const requestUrl = request.url();

    const resourceType = request.resourceType();
    // 检查是否为媒体请求
    if (resourceType === "media") {
      console.log("resourceType", resourceType);
      console.log("requestUrl", requestUrl);
      audioUrl = requestUrl;
    }
  });
  // try {
  //   console.log("请求地址为：", url);
  try {
    const response = await page.goto(url, { waitUntil: "networkidle2" });
    if (response.ok()) {
      console.log("Page loaded successfully.");
      // 使用 page.evaluate 获取页面元素内容
      const content = await page.evaluate(() => {
        const element = document.querySelector(".phraseSpeech:first-of-type");
        return element ? element.innerHTML : null;
      });
      console.log("Element content:", content);
      await page.click(".phraseSpeech:first-of-type");
      // // 等待一段时间以确保请求完成
      // await page.waitForTimeout(3000);

      await browser.close();

      return audioUrl;
    } else {
      console.error("Page failed to load with status:", response.status());
    }
  } catch (error) {
    console.error("Error loading page:", error);
  }

  // } catch (error) {
  //   console.error(`Failed to fetch audio URL for word "${word}":`, error);
  //   await browser.close();
  //   return null;
  // }
}

// 下载音频文件
async function downloadAudio(url, filepath) {
  const response = await axios({
    url,
    responseType: "stream",
  });
  return new Promise((resolve, reject) => {
    response.data
      .pipe(fs.createWriteStream(filepath))
      .on("finish", resolve)
      .on("error", reject);
  });
}

// 爬取百度图片并获取图片URL
async function fetchImageUrl(word) {
  const url = `https://image.baidu.com/search/index?tn=baiduimage&word=${word}`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2" });

    // 获取第一张图片的URL
    const imageUrl = await page.evaluate(() => {
      const img = document.querySelector(".main_img");
      return img ? img.getAttribute("data-imgurl") : null;
    });

    await browser.close();
    return imageUrl;
  } catch (error) {
    console.error(`Failed to fetch image URL for word "${word}":`, error);
    await browser.close();
    return null;
  }
}

// 创建图片并添加文本
async function createImage(word, imageUrl) {
  const outputImagePath = path.join(__dirname, outputPath, `${word.zh}.png`);

  const imageBuffer = await axios({
    url: imageUrl,
    responseType: "arraybuffer",
  }).then((response) => Buffer.from(response.data));

  const textBuffer = await sharp({
    create: {
      width: 300,
      height: 120,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(`<svg width="300" height="120">
            <text x="150" y="60" text-anchor="middle" font-size="35" alignment-baseline="middle">${word.en}</text>
            <text x="150" y="90" text-anchor="middle" font-size="35" dy="10" alignment-baseline="middle">${word.zh}</text>
          </svg>`),
        gravity: "center",
      },
    ])
    .png()
    .toBuffer();

  await sharp(imageBuffer)
    .resize(800, 600)
    .composite([{ input: textBuffer, gravity: "south" }])
    .toFile(outputImagePath);

  console.log(`Created image for word: ${word.zh}`);
}

async function main() {
  // Usage example
  const targetPath = path.join(__dirname, outputPath);
  await managePath(targetPath);
  const images = [];

  for (const word of words) {
    try {
      const imageUrl = await fetchImageUrl(word.zh);
      const audioUrl = await fetchAudioUrl(word.en);

      if (imageUrl && audioUrl) {
        await createImage(word, imageUrl);
        const audioPath = path.join(__dirname, outputPath, `${word.zh}.mp3`);
        await downloadAudio(audioUrl, audioPath);
        images.push(word);
      } else {
        console.log(`No image or audio found for word: ${word}`);
      }
      // 请求间延迟2秒
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error processing word "${word}":`, error);
    }
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Image and Audio Gallery</title>
    <style>
        body {
            font-family: Arial, sans-serif;
        }
        .gallery img {
            width: 200px;
            height: auto;
            margin: 10px;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .gallery img:hover {
            transform: scale(1.1);
        }
        .overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            justify-content: center;
            align-items: center;
            z-index: 1000;
            flex-direction: column;
        }
        .overlay img {
            max-width: 90%;
            max-height: 80%;
            cursor: pointer;
        }
        .overlay .prev, .overlay .next {
            position: absolute;
             color: white;
             font-size: 109px;
            cursor: pointer;
            top: 50%;
            transform: translateY(-50%);
        }
        .overlay .close {
            top: 4%;
            right: 3%;
            position: absolute;
            width: 50px;
            height: 50px;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: white;
            border: 2px solid white;
            border-radius: 50%;
            cursor: pointer;
            font-weight: bold;
            font-size: 49px;
            color: #107C10;
        }
        .overlay .prev {
            left: 20px;
        }
        .overlay .next {
            right: 20px;
        }
        .overlay audio {
            position: absolute;
            bottom: 20px;
            width: 90%;
        }
        .mode-button {
            margin: 20px;
            padding: 10px 20px;
            font-size: 16px;
            cursor: pointer;
            color: white;
            background: #007bff;
            border: none;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <div class="gallery">
        ${images
          .map(
            (word, index) =>
              `<img src="./${word.zh}.png" data-index="${index}" alt="${word.en}" data-audio="${word.zh}.mp3">`
          )
          .join("")}
    </div>
    <div class="overlay">
        <span class="close">&times;</span>
        <span class="prev">&#10094;</span>
        <img src="" alt="">
        <audio controls></audio>
        <span class="next">&#10095;</span>
        <button class="mode-button">进入听写模式</button>
    </div>
    <script>
        const images = document.querySelectorAll('.gallery img');
        const overlay = document.querySelector('.overlay');
        const overlayImage = document.querySelector('.overlay img');
        const overlayAudio = document.querySelector('.overlay audio');
        const closeBtn = document.querySelector('.overlay .close');
        const prevBtn = document.querySelector('.overlay .prev');
        const nextBtn = document.querySelector('.overlay .next');
        const modeButton = document.querySelector('.mode-button');
        let currentIndex;
        let dictationMode = false;

        function showOverlay(index) {
            currentIndex = index;
            updateOverlayContent();
            overlay.style.display = 'flex';
        }

        function updateOverlayContent() {
            overlayImage.src = images[currentIndex].src;
            overlayAudio.src = images[currentIndex].getAttribute('data-audio');
            overlayAudio.play();
        }

        images.forEach((img, index) => {
            img.addEventListener('click', () => showOverlay(index));
        });

        closeBtn.addEventListener('click', () => {
            overlay.style.display = 'none';
            overlayAudio.pause();
        });

        prevBtn.addEventListener('click', () => {
            currentIndex = (currentIndex > 0) ? currentIndex - 1 : images.length - 1;
            updateOverlayContent();
        });

        nextBtn.addEventListener('click', () => {
            currentIndex = (currentIndex < images.length - 1) ? currentIndex + 1 : 0;
            updateOverlayContent();
        });

        overlayImage.addEventListener('click', () => {
            if (overlayAudio.paused) {
                overlayAudio.play();
            } else {
                overlayAudio.pause();
            }
        });

        modeButton.addEventListener('click', () => {
            dictationMode = !dictationMode;
               modeButton.textContent = dictationMode ? '继续学习' : '进入听写模式';
            overlayImage.style.display = dictationMode ? 'none' : 'block';
        });
    </script>
</body>
</html>
`;
  fs.writeFileSync(
    path.join(__dirname, outputPath, "index.html"),
    htmlContent,
    "utf8"
  );
}

main();
