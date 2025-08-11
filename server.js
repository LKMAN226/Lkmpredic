// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'api-football-v1.p.rapidapi.com';
const BASE_URL = `https://${RAPIDAPI_HOST}/v3`;

// Simple health-check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'LKprediction backend en ligne ✅' });
});

/**
 * GET /matches/today
 * Optionnel: ?date=YYYY-MM-DD
 * Renvoie les fixtures du jour (ou de la date fournie)
 */
app.get('/matches/today', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10);
    const url = `${BASE_URL}/fixtures`;
    const r = await axios.get(url, {
      params: { date },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    });
    return res.json(r.data);
  } catch (err) {
    console.error('Erreur /matches/today:', err.message || err);
    return res.status(500).json({ error: 'Impossible de récupérer les matchs' });
  }
});

/**
 * GET /matches/league/:leagueId
 * Ex: /matches/league/39  (Premier League)
 * Optionnel: ?season=2024
 */
app.get('/matches/league/:leagueId', async (req, res) => {
  try {
    const league = req.params.leagueId;
    const season = req.query.season || (new Date().getFullYear());
    const url = `${BASE_URL}/fixtures`;
    const r = await axios.get(url, {
      params: { league, season },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    });
    return res.json(r.data);
  } catch (err) {
    console.error('Erreur /matches/league:', err.message || err);
    return res.status(500).json({ error: 'Impossible de récupérer les matchs de la ligue' });
  }
});

/**
 * GET /odds/fixture/:fixtureId
 * Renvoie les cotes bookmakers pour un fixture (si disponibles)
 */
app.get('/odds/fixture/:fixtureId', async (req, res) => {
  try {
    const fixture = req.params.fixtureId;
    const url = `${BASE_URL}/odds`;
    const r = await axios.get(url, {
      params: { fixture },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    });
    return res.json(r.data);
  } catch (err) {
    console.error('Erreur /odds/fixture:', err.message || err);
    return res.status(500).json({ error: 'Impossible de récupérer les cotes' });
  }
});

/**
 * POST /predict
 * Body: { fixtureId: number }
 * Stratégie:
 *  - Si on a des cotes (odds) : on calcule probabilités implicites normalisées
 *  - Sinon : on retourne probas par défaut (home 0.45, draw 0.25, away 0.30)
 */
app.post('/predict', async (req, res) => {
  try {
    const { fixtureId } = req.body;
    if (!fixtureId) return res.status(400).json({ error: 'fixtureId requis' });

    // 1) essayer de récupérer les cotes
    const oddsUrl = `${BASE_URL}/odds`;
    const oddsResp = await axios.get(oddsUrl, {
      params: { fixture: fixtureId },
      headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    });

    const oddsData = oddsResp.data?.response || [];
    // chercher la première bookmaker avec markets/1x2 en cote décimale
    let probs = null;
    if (oddsData.length > 0) {
      // flatten: oddsData -> bookmakers -> markets -> outcomes (home/draw/away)
      for (const book of oddsData) {
        if (!book.bookmakers) continue;
        for (const bm of book.bookmakers) {
          if (!bm.markets) continue;
          for (const market of bm.markets) {
            if (market.market === '3-way' || market.key === '3way' || market.key === 'h2h') {
              const outcomes = market.outcomes || [];
              // outcomes may have decimals
              const homeOdd = outcomes.find(o => /home/i.test(o.name))?.price;
              const drawOdd = outcomes.find(o => /draw|tie/i.test(o.name))?.price;
              const awayOdd = outcomes.find(o => /away/i.test(o.name))?.price;
              if (homeOdd && drawOdd && awayOdd) {
                // Convertir cotes décimales en probabilités implicites
                const ih = 1 / parseFloat(homeOdd);
                const id = 1 / parseFloat(drawOdd);
                const ia = 1 / parseFloat(awayOdd);
                const s = ih + id + ia;
                probs = {
                  home: ih / s,
                  draw: id / s,
                  away: ia / s
                };
                break;
              }
            }
          }
          if (probs) break;
        }
        if (probs) break;
      }
    }

    // fallback si pas de cotes ou erreur
    if (!probs) {
      probs = { home: 0.45, draw: 0.25, away: 0.30 };
    }

    return res.json({
      fixtureId,
      probabilities: {
        home_win: Number((probs.home).toFixed(3)),
        draw: Number((probs.draw).toFixed(3)),
        away_win: Number((probs.away).toFixed(3))
      },
      source: oddsData.length > 0 ? 'bookmaker_odds' : 'heuristic_default'
    });
  } catch (err) {
    console.error('Erreur /predict:', err.message || err);
    return res.status(500).json({ error: 'Erreur lors du calcul de la prédiction' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ LKprediction backend démarré sur le port ${PORT}`);
});
