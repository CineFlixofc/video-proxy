// ------------------- O CÉREBRO DO ROBÔ (server.js) -------------------

const express = require('express');
const puppeteer = require('puppeteer');

// --- CONFIGURAÇÕES ---
const app = express();
const PORT = process.env.PORT || 3000; // Render vai definir a porta automaticamente
const DOMAIN_EMBED = 'short.icu'; // O domínio que descobrimos

// --- CACHE SIMPLES PARA VELOCIDADE E EFICIÊNCIA ---
// Guarda os links encontrados para não precisar buscar toda vez.
// Chave: videoId, Valor: { url: '...', timestamp: ... }
const linkCache = new Map();
const CACHE_DURATION_HOURS = 2; // O link ficará guardado por 2 horas

/**
 * A função principal que faz a "mágica".
 * Ela navega como um usuário real para extrair o link .m3u8.
 */
async function getDirectLink(videoId) {
  console.log(`Buscando link para o ID: ${videoId}`);
  let browser = null;
  try {
    const embedUrl = `https://${DOMAIN_EMBED}/${videoId}`;

    // Inicia o Puppeteer. As 'args' são cruciais para rodar no Render.
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Disfarça nosso robô como um navegador comum para evitar bloqueios
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36');

    let foundUrl = null;
    const linkPromise = new Promise(resolve => {
      page.on('request', (request) => {
        if (request.url().endsWith('.m3u8')) {
          console.log('SUCESSO: Link .m3u8 encontrado!', request.url());
          foundUrl = request.url();
          resolve(foundUrl);
        }
      });
    });

    console.log(`Navegando para: ${embedUrl}`);
    await page.goto(embedUrl, { waitUntil: 'networkidle2' });
    
    // Tenta clicar no botão de play se ele existir, para iniciar o vídeo
    await page.evaluate(() => {
        const playButton = document.querySelector('.vjs-big-play-button') || document.querySelector('button[title="Play Video"]');
        if (playButton) playButton.click();
    }).catch(e => console.log('Não foi necessário clicar no play, ou o botão não foi encontrado.'));


    // Espera pelo link por até 20 segundos.
    await Promise.race([
        linkPromise,
        new Promise(resolve => setTimeout(resolve, 20000))
    ]);
    
    return foundUrl;
  } catch (error) {
    console.error(`Erro ao processar o vídeo ${videoId}:`, error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
      console.log('Navegador fechado.');
    }
  }
}

// --- ENDPOINTS DA NOSSA API ---

// Endpoint principal para obter o link
app.get('/api/video', async (req, res) => {
  const videoId = req.query.id;

  if (!videoId) {
    return res.status(400).json({ error: 'Parâmetro "id" do vídeo é obrigatório.' });
  }

  // 1. VERIFICAR O CACHE PRIMEIRO
  if (linkCache.has(videoId)) {
    const cachedData = linkCache.get(videoId);
    const ageInHours = (Date.now() - cachedData.timestamp) / (1000 * 60 * 60);
    if (ageInHours < CACHE_DURATION_HOURS) {
      console.log(`CACHE HIT: Servindo link do cache para o ID: ${videoId}`);
      return res.status(200).json({ success: true, url: cachedData.url, source: 'cache' });
    }
  }

  // 2. SE NÃO ESTIVER NO CACHE, BUSCAR O LINK
  console.log(`CACHE MISS: Buscando novo link para o ID: ${videoId}`);
  const directLink = await getDirectLink(videoId);

  if (directLink) {
    // 3. SALVAR O LINK NOVO NO CACHE
    linkCache.set(videoId, { url: directLink, timestamp: Date.now() });
    res.status(200).json({ success: true, url: directLink, source: 'live' });
  } else {
    res.status(404).json({ error: 'Não foi possível encontrar o link de streaming (.m3u8).' });
  }
});

// Endpoint raiz para verificar se o robô está vivo
app.get('/', (req, res) => {
  res.send('Servidor Proxy de Vídeo está no ar! Use o endpoint /api/video?id=SEU_ID');
});


// --- INICIAR O SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
