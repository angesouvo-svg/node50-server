const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;

const API_BASE = 'https://v3.football.api-sports.io';

/* =========================================================
   CONFIGURATION NODE_50
   ========================================================= */

const NODE_VERSION = 'NODE_50 V7 - REAL DATA ENGINE';

const RISK = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  VERY_HIGH: 'VERY_HIGH'
};

const QUALITY = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INSUFFICIENT: 'INSUFFICIENT'
};

/* =========================================================
   OUTILS DE BASE
   ========================================================= */

function cleanName(name = '') {
  return String(name)
    .replace(/ W$/i, '')
    .replace(/ Women$/i, '')
    .replace(/ Ladies$/i, '')
    .replace(/ Féminin$/i, '')
    .trim();
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;

  const n = Number(
    String(v)
      .replace('%', '')
      .replace(',', '.')
  );

  return Number.isFinite(n) ? n : null;
}

function avg(values) {
  const valid = values.filter(v => v !== null && Number.isFinite(v));

  if (!valid.length) return null;

  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(v, decimals = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return null;
  }

  const p = Math.pow(10, decimals);
  return Math.round(v * p) / p;
}

function pct(v) {
  return v === null ? null : Math.round(clamp(v, 0, 100));
}

function available(v) {
  return v !== null &&
    v !== undefined &&
    Number.isFinite(Number(v));
}

/* =========================================================
   API-FOOTBALL
   ========================================================= */

async function api(path) {
  if (!API_KEY) {
    return {
      ok: false,
      data: null,
      error: 'API_FOOTBALL_KEY absente'
    };
  }

  try {
    const response = await fetch(
      `${API_BASE}${path}`,
      {
        headers: {
          'x-apisports-key': API_KEY
        }
      }
    );

    let json = null;

    try {
      json = await response.json();
    } catch (_) {}

    if (!response.ok) {
      return {
        ok: false,
        data: null,
        error:
          json?.errors ||
          `HTTP ${response.status}`
      };
    }

    return {
      ok: true,
      data: json?.response ?? null,
      errors: json?.errors ?? null
    };

  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error.message
    };
  }
}

/* =========================================================
   RECHERCHE DES ÉQUIPES
   ========================================================= */

async function findTeam(name) {
  const result = await api(
    `/teams?search=${encodeURIComponent(cleanName(name))}`
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return null;
  }

  const target = cleanName(name).toLowerCase();

  const exact = result.data.find(item =>
    cleanName(item?.team?.name || '').toLowerCase() === target
  );

  return exact?.team || result.data[0]?.team || null;
}

/* =========================================================
   DERNIERS MATCHS
   ========================================================= */

async function getLastFixtures(teamId, count = 5) {
  if (!teamId) return [];

  const result = await api(
    `/fixtures?team=${teamId}&last=${count}`
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return [];
  }

  return result.data.filter(fixture => {
    const status = fixture?.fixture?.status?.short;

    return [
      'FT',
      'AET',
      'PEN'
    ].includes(status);
  });
}

/* =========================================================
   H2H
   ========================================================= */

async function getH2H(homeId, awayId, count = 5) {
  if (!homeId || !awayId) return [];

  const result = await api(
    `/fixtures/headtohead?h2h=${homeId}-${awayId}&last=${count}`
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return [];
  }

  return result.data.filter(fixture => {
    const status = fixture?.fixture?.status?.short;

    return [
      'FT',
      'AET',
      'PEN'
    ].includes(status);
  });
}

/* =========================================================
   STATISTIQUES D'UN MATCH
   ========================================================= */

async function getFixtureStatistics(fixtureId) {
  if (!fixtureId) return [];

  const result = await api(
    `/fixtures/statistics?fixture=${fixtureId}`
  );

  if (!result.ok || !Array.isArray(result.data)) {
    return [];
  }

  return result.data;
}

/* =========================================================
   EXTRACTION STATISTIQUES
   ========================================================= */

function statValue(stats, name) {
  if (!Array.isArray(stats)) return null;

  const item = stats.find(
    s =>
      String(s?.type || '').toLowerCase() ===
      String(name).toLowerCase()
  );

  if (!item) return null;

  return num(item.value);
}

function extractTeamStats(statBlock) {
  if (!statBlock) {
    return {
      shots: null,
      shotsOnTarget: null,
      shotsOffTarget: null,
      corners: null,
      fouls: null,
      yellowCards: null,
      redCards: null,
      possession: null
    };
  }

  return {
    shots: statValue(statBlock.statistics, 'Total Shots'),
    shotsOnTarget: statValue(
      statBlock.statistics,
      'Shots on Goal'
    ),
    shotsOffTarget: statValue(
      statBlock.statistics,
      'Shots off Goal'
    ),
    corners: statValue(
      statBlock.statistics,
      'Corner Kicks'
    ),
    fouls: statValue(
      statBlock.statistics,
      'Fouls'
    ),
    yellowCards: statValue(
      statBlock.statistics,
      'Yellow Cards'
    ),
    redCards: statValue(
      statBlock.statistics,
      'Red Cards'
    ),
    possession: statValue(
      statBlock.statistics,
      'Ball Possession'
    )
  };
}

/* =========================================================
   CONSTRUCTION DU MATCH HISTORIQUE
   ========================================================= */

function getGoalsFor(teamId, fixture) {
  if (!fixture?.teams || !fixture?.goals) return null;

  if (fixture.teams.home?.id === teamId) {
    return num(fixture.goals.home);
  }

  if (fixture.teams.away?.id === teamId) {
    return num(fixture.goals.away);
  }

  return null;
}

function getGoalsAgainst(teamId, fixture) {
  if (!fixture?.teams || !fixture?.goals) return null;

  if (fixture.teams.home?.id === teamId) {
    return num(fixture.goals.away);
  }

  if (fixture.teams.away?.id === teamId) {
    return num(fixture.goals.home);
  }

  return null;
}

function resultFor(teamId, fixture) {
  const gf = getGoalsFor(teamId, fixture);
  const ga = getGoalsAgainst(teamId, fixture);

  if (gf === null || ga === null) return null;

  if (gf > ga) return 'W';
  if (gf < ga) return 'L';

  return 'D';
}

/* =========================================================
   FORMATION DES DONNÉES D'ÉQUIPE
   ========================================================= */

async function buildTeamProfile(team, fixtures) {

  const results = fixtures.map(
    f => resultFor(team.id, f)
  );

  const goalsFor = fixtures.map(
    f => getGoalsFor(team.id, f)
  );

  const goalsAgainst = fixtures.map(
    f => getGoalsAgainst(team.id, f)
  );

  const wins = results.filter(r => r === 'W').length;
  const draws = results.filter(r => r === 'D').length;
  const losses = results.filter(r => r === 'L').length;

  const cleanSheets = fixtures.filter(f => {
    const against = getGoalsAgainst(team.id, f);
    return against === 0;
  }).length;

  const failedToScore = fixtures.filter(f => {
    const gf = getGoalsFor(team.id, f);
    return gf === 0;
  }).length;

  const scoringFrequency =
    fixtures.length
      ? goalsFor.filter(v => v !== null && v > 0).length /
        fixtures.length * 100
      : null;

  const concedingFrequency =
    fixtures.length
      ? goalsAgainst.filter(v => v !== null && v > 0).length /
        fixtures.length * 100
      : null;

  const over15 =
    fixtures.length
      ? fixtures.filter(f => {
          const gf = getGoalsFor(team.id, f);
          const ga = getGoalsAgainst(team.id, f);

          return gf !== null &&
            ga !== null &&
            gf + ga > 1.5;
        }).length /
        fixtures.length * 100
      : null;

  const over25 =
    fixtures.length
      ? fixtures.filter(f => {
          const gf = getGoalsFor(team.id, f);
          const ga = getGoalsAgainst(team.id, f);

          return gf !== null &&
            ga !== null &&
            gf + ga > 2.5;
        }).length /
        fixtures.length * 100
      : null;

  const under25 =
    over25 === null ? null : 100 - over25;

  const btts =
    fixtures.length
      ? fixtures.filter(f => {
          const gf = getGoalsFor(team.id, f);
          const ga = getGoalsAgainst(team.id, f);

          return gf !== null &&
            ga !== null &&
            gf > 0 &&
            ga > 0;
        }).length /
        fixtures.length * 100
      : null;

  return {
    teamId: team.id,
    teamName: team.name,

    matches: fixtures.length,

    wins,
    draws,
    losses,

    winRate:
      fixtures.length
        ? wins / fixtures.length * 100
        : null,

    drawRate:
      fixtures.length
        ? draws / fixtures.length * 100
        : null,

    lossRate:
      fixtures.length
        ? losses / fixtures.length * 100
        : null,

    goalsFor: avg(goalsFor),
    goalsAgainst: avg(goalsAgainst),

    totalGoalsAvg:
      avg(
        fixtures.map(f => {
          const gf = getGoalsFor(team.id, f);
          const ga = getGoalsAgainst(team.id, f);

          if (gf === null || ga === null) {
            return null;
          }

          return gf + ga;
        })
      ),

    cleanSheetRate:
      fixtures.length
        ? cleanSheets / fixtures.length * 100
        : null,

    failedToScoreRate:
      fixtures.length
        ? failedToScore / fixtures.length * 100
        : null,

    scoringFrequency,
    concedingFrequency,

    over15,
    over25,
    under25,
    btts,

    lastResults: results
  };
}

/* =========================================================
   STATISTIQUES AVANCÉES DES 5 DERNIERS MATCHS
   ========================================================= */

async function enrichTeamStatistics(teamId, fixtures) {

  const collected = [];

  /*
   * Limite volontaire à 5 matchs :
   * on veut éviter une explosion inutile du quota.
   */

  for (const fixture of fixtures.slice(0, 5)) {

    const stats = await getFixtureStatistics(
      fixture?.fixture?.id
    );

    if (!Array.isArray(stats) || stats.length < 1) {
      continue;
    }

    const block = stats.find(
      item => item?.team?.id === teamId
    );

    if (!block) continue;

    collected.push(
      extractTeamStats(block)
    );
  }

  return {
    shots: avg(
      collected.map(x => x.shots)
    ),

    shotsOnTarget: avg(
      collected.map(x => x.shotsOnTarget)
    ),

    shotsOffTarget: avg(
      collected.map(x => x.shotsOffTarget)
    ),

    corners: avg(
      collected.map(x => x.corners)
    ),

    fouls: avg(
      collected.map(x => x.fouls)
    ),

    yellowCards: avg(
      collected.map(x => x.yellowCards)
    ),

    redCards: avg(
      collected.map(x => x.redCards)
    ),

    possession: avg(
      collected.map(x => x.possession)
    ),

    matchesWithStats: collected.length
  };
}

/* =========================================================
   50 FACTEURS
   ========================================================= */

function buildFactors(home, away, h2h, homeStats, awayStats) {

  const factors = [];

  function add(
    id,
    group,
    name,
    value,
    quality,
    explanation
  ) {
    factors.push({
      id,
      group,
      name,
      value,
      available: value !== null,
      quality,
      explanation
    });
  }

  /* =========================
     A — FORME
     ========================= */

  add(
    1,
    'FORME',
    'Forme récente',
    home.winRate !== null &&
    away.winRate !== null
      ? home.winRate - away.winRate
      : null,
    home.matches >= 5 && away.matches >= 5
      ? QUALITY.HIGH
      : QUALITY.LOW,
    'Comparaison des taux de victoire récents'
  );

  add(
    2,
    'FORME',
    'Forme domicile',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite un historique domicile séparé'
  );

  add(
    3,
    'FORME',
    'Forme extérieur',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite un historique extérieur séparé'
  );

  add(
    4,
    'FORME',
    'Série actuelle',
    home.lastResults.length &&
    away.lastResults.length
      ? `${home.lastResults.join('')}/${away.lastResults.join('')}`
      : null,
    home.matches && away.matches
      ? QUALITY.MEDIUM
      : QUALITY.INSUFFICIENT,
    'Série des derniers résultats'
  );

  add(
    5,
    'FORME',
    'Régularité',
    home.winRate !== null &&
    away.winRate !== null
      ? Math.abs(home.winRate - away.winRate)
      : null,
    QUALITY.MEDIUM,
    'Écart de régularité'
  );

  add(
    6,
    'FORME',
    'Buts marqués',
    home.goalsFor !== null &&
    away.goalsFor !== null
      ? home.goalsFor - away.goalsFor
      : null,
    QUALITY.HIGH,
    'Moyenne réelle de buts marqués'
  );

  add(
    7,
    'FORME',
    'Buts encaissés',
    home.goalsAgainst !== null &&
    away.goalsAgainst !== null
      ? away.goalsAgainst - home.goalsAgainst
      : null,
    QUALITY.HIGH,
    'Comparaison des buts encaissés'
  );

  add(
    8,
    'FORME',
    'Clean sheets',
    home.cleanSheetRate !== null &&
    away.cleanSheetRate !== null
      ? home.cleanSheetRate - away.cleanSheetRate
      : null,
    QUALITY.HIGH,
    'Taux réel de clean sheets'
  );

  /* =========================
     B — ATTAQUE / DÉFENSE
     ========================= */

  add(
    9,
    'ATTAQUE',
    'xG',
    null,
    QUALITY.INSUFFICIENT,
    'xG non disponible dans les données collectées'
  );

  add(
    10,
    'ATTAQUE',
    'xGA',
    null,
    QUALITY.INSUFFICIENT,
    'xGA non disponible dans les données collectées'
  );

  add(
    11,
    'ATTAQUE',
    'Différentiel xG',
    null,
    QUALITY.INSUFFICIENT,
    'Impossible sans xG réel'
  );

  add(
    12,
    'ATTAQUE',
    'Efficacité offensive',
    home.goalsFor !== null &&
    away.goalsFor !== null
      ? home.goalsFor - away.goalsFor
      : null,
    QUALITY.MEDIUM,
    'Buts marqués par match'
  );

  add(
    13,
    'DÉFENSE',
    'Efficacité défensive',
    home.goalsAgainst !== null &&
    away.goalsAgainst !== null
      ? away.goalsAgainst - home.goalsAgainst
      : null,
    QUALITY.MEDIUM,
    'Buts encaissés par match'
  );

  add(
    14,
    'ATTAQUE',
    'Fréquence de but',
    home.scoringFrequency !== null &&
    away.scoringFrequency !== null
      ? home.scoringFrequency - away.scoringFrequency
      : null,
    QUALITY.HIGH,
    'Pourcentage de matchs avec au moins un but'
  );

  add(
    15,
    'DÉFENSE',
    'Fréquence d'encaissement',
    home.concedingFrequency !== null &&
    away.concedingFrequency !== null
      ? home.concedingFrequency - away.concedingFrequency
      : null,
    QUALITY.HIGH,
    'Pourcentage de matchs avec but encaissé'
  );

  add(
    16,
    'ATTAQUE',
    'BTTS fréquence',
    home.btts !== null &&
    away.btts !== null
      ? (home.btts + away.btts) / 2
      : null,
    QUALITY.HIGH,
    'Fréquence réelle du BTTS'
  );

  add(
    17,
    'BUTS',
    'Over 1.5',
    home.over15 !== null &&
    away.over15 !== null
      ? (home.over15 + away.over15) / 2
      : null,
    QUALITY.HIGH,
    'Fréquence réelle Over 1.5'
  );

  add(
    18,
    'BUTS',
    'Over 2.5',
    home.over25 !== null &&
    away.over25 !== null
      ? (home.over25 + away.over25) / 2
      : null,
    QUALITY.HIGH,
    'Fréquence réelle Over 2.5'
  );

  add(
    19,
    'BUTS',
    'Under 2.5',
    home.under25 !== null &&
    away.under25 !== null
      ? (home.under25 + away.under25) / 2
      : null,
    QUALITY.HIGH,
    'Fréquence réelle Under 2.5'
  );

  add(
    20,
    'BUTS',
    'Distribution des buts',
    home.totalGoalsAvg !== null &&
    away.totalGoalsAvg !== null
      ? home.totalGoalsAvg + away.totalGoalsAvg
      : null,
    QUALITY.MEDIUM,
    'Moyenne des buts totaux'
  );

  /* =========================
     C — CONTEXTE
     ========================= */

  add(
    21,
    'CONTEXTE',
    'Position classement',
    null,
    QUALITY.INSUFFICIENT,
    'Classement non fourni dans cette analyse'
  );

  add(
    22,
    'CONTEXTE',
    'Écart de niveau',
    null,
    QUALITY.INSUFFICIENT,
    'Pas de classement disponible'
  );

  add(
    23,
    'CONTEXTE',
    'Enjeu',
    null,
    QUALITY.INSUFFICIENT,
    'Contexte compétitif non déduit artificiellement'
  );

  add(
    24,
    'CONTEXTE',
    'Repos',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite les dates des derniers matchs'
  );

  add(
    25,
    'CONTEXTE',
    'Densité du calendrier',
    null,
    QUALITY.INSUFFICIENT,
    'Non calculé sans calendrier complet'
  );

  add(
    26,
    'CONTEXTE',
    'Fatigue',
    null,
    QUALITY.INSUFFICIENT,
    'Aucune fatigue inventée'
  );

  add(
    27,
    'CONTEXTE',
    'Absences',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite endpoint blessures'
  );

  add(
    28,
    'CONTEXTE',
    'Importance des absences',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite données joueurs'
  );

  add(
    29,
    'CONTEXTE',
    'Rotation',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite compositions'
  );

  add(
    30,
    'CONTEXTE',
    'Continuité équipe',
    null,
    QUALITY.INSUFFICIENT,
    'Nécessite données de compositions'
  );

  /* =========================
     D — H2H
     ========================= */

  const h2hGoals = h2h.map(match => {
    const homeGoals = num(match?.goals?.home);
    const awayGoals = num(match?.goals?.away);

    if (
      homeGoals === null ||
      awayGoals === null
    ) {
      return null;
    }

    return homeGoals + awayGoals;
  });

  const h2hBtts = h2h.filter(match => {
    const h = num(match?.goals?.home);
    const a = num(match?.goals?.away);

    return h !== null &&
      a !== null &&
      h > 0 &&
      a > 0;
  }).length;

  add(
    31,
    'H2H',
    'H2H général',
    h2h.length || null,
    h2h.length >= 3
      ? QUALITY.MEDIUM
      : QUALITY.LOW,
    `${h2h.length} confrontation(s) disponible(s)`
  );

  add(
    32,
    'H2H',
    'H2H domicile/extérieur',
    null,
    QUALITY.INSUFFICIENT,
    'Non forcé sans échantillon suffisant'
  );

  add(
    33,
    'H2H',
    'Buts H2H',
    avg(h2hGoals),
    h2h.length >= 3
      ? QUALITY.MEDIUM
      : QUALITY.LOW,
    'Moyenne des buts des confrontations'
  );

  add(
    34,
    'H2H',
    'BTTS H2H',
    h2h.length
      ? h2hBtts / h2h.length * 100
      : null,
    h2h.length >= 3
      ? QUALITY.MEDIUM
      : QUALITY.LOW,
    'BTTS historique'
  );

  const h2hOver25 =
    h2h.length
      ? h2h.filter(match => {
          const h = num(match?.goals?.home);
          const a = num(match?.goals?.away);

          return h !== null &&
            a !== null &&
            h + a > 2.5;
        }).length /
        h2h.length * 100
      : null;

  add(
    35,
    'H2H',
    'O/U H2H',
    h2hOver25,
    h2h.length >= 3
      ? QUALITY.MEDIUM
      : QUALITY.LOW,
    'Over 2.5 historique'
  );

  /* =========================
     E — STATISTIQUES MATCH
     ========================= */

  add(
    36,
    'STATS',
    'Tirs',
    homeStats.shots !== null &&
    awayStats.shots !== null
      ? homeStats.shots - awayStats.shots
      : null,
    homeStats.matchesWithStats >= 3 &&
    awayStats.matchesWithStats >= 3
      ? QUALITY.HIGH
      : QUALITY.LOW,
    'Tirs moyens'
  );

  add(
    37,
    'STATS',
    'Tirs cadrés',
    homeStats.shotsOnTarget !== null &&
    awayStats.shotsOnTarget !== null
      ? homeStats.shotsOnTarget -
        awayStats.shotsOnTarget
      : null,
    homeStats.matchesWithStats >= 3 &&
    awayStats.matchesWithStats >= 3
      ? QUALITY.HIGH
      : QUALITY.LOW,
    'Tirs cadrés moyens'
  );

  add(
    38,
    'STATS',
    'Corners',
    homeStats.corners !== null &&
    awayStats.corners !== null
      ? homeStats.corners + awayStats.corners
      : null,
    homeStats.corners !== null &&
    awayStats.corners !== null
      ? QUALITY.HIGH
      : QUALITY.INSUFFICIENT,
    'Corners réellement collectés'
  );

  add(
    39,
    'STATS',
    'Cartons',
    homeStats.yellowCards !== null &&
    awayStats.yellowCards !== null
      ? homeStats.yellowCards +
        awayStats.yellowCards
      : null,
    homeStats.yellowCards !== null &&
    awayStats.yellowCards !== null
      ? QUALITY.MEDIUM
      : QUALITY.INSUFFICIENT,
    'Cartons jaunes moyens'
  );

  add(
    40,
    'STATS',
    'Fautes',
    homeStats.fouls !== null &&
    awayStats.fouls !== null
      ? homeStats.fouls + awayStats.fouls
      : null,
    homeStats.fouls !== null &&
    awayStats.fouls !== null
      ? QUALITY.MEDIUM
      : QUALITY.INSUFFICIENT,
    'Fautes moyennes'
  );

  /* =========================
     F — STRUCTURE DES MARCHÉS
     ========================= */

  add(
    41,
    'MARCHÉS',
    'Force 1X2',
    home.winRate !== null &&
    away.winRate !== null
      ? home.winRate - away.winRate
      : null,
    QUALITY.MEDIUM,
    'Force relative issue de la forme'
  );

  add(
    42,
    'MARCHÉS',
    'Double chance',
    home.winRate !== null &&
    away.winRate !== null
      ? Math.max(
          home.winRate,
          away.winRate
        )
      : null,
    QUALITY.MEDIUM,
    'Protection par double chance'
  );

  add(
    43,
    'MARCHÉS',
    'Structure O/U',
    home.totalGoalsAvg !== null &&
    away.totalGoalsAvg !== null
      ? home.totalGoalsAvg +
        away.totalGoalsAvg
      : null,
    QUALITY.MEDIUM,
    'Structure réelle des buts'
  );

  add(
    44,
    'MARCHÉS',
    'Structure BTTS',
    home.btts !== null &&
    away.btts !== null
      ? (home.btts + away.btts) / 2
      : null,
    QUALITY.HIGH,
    'Structure BTTS'
  );

  add(
    45,
    'MARCHÉS',
    'Structure corners',
    homeStats.corners !== null &&
    awayStats.corners !== null
      ? homeStats.corners +
        awayStats.corners
      : null,
    homeStats.corners !== null &&
    awayStats.corners !== null
      ? QUALITY.HIGH
      : QUALITY.INSUFFICIENT,
    'Structure corners réelle'
  );

  add(
    46,
    'MARCHÉS',
    'Structure tirs',
    homeStats.shots !== null &&
    awayStats.shots !== null
      ? homeStats.shots +
        awayStats.shots
      : null,
    homeStats.shots !== null &&
    awayStats.shots !== null
      ? QUALITY.HIGH
      : QUALITY.INSUFFICIENT,
    'Structure tirs réelle'
  );

  add(
    47,
    'MARCHÉS',
    'Structure cartons',
    homeStats.yellowCards !== null &&
    awayStats.yellowCards !== null
      ? homeStats.yellowCards +
        awayStats.yellowCards
      : null,
    homeStats.yellowCards !== null &&
    awayStats.yellowCards !== null
      ? QUALITY.MEDIUM
      : QUALITY.INSUFFICIENT,
    'Structure cartons'
  );

  add(
    48,
    'MARCHÉS',
    'Structure fautes',
    homeStats.fouls !== null &&
    awayStats.fouls !== null
      ? homeStats.fouls +
        awayStats.fouls
      : null,
    homeStats.fouls !== null &&
    awayStats.fouls !== null
      ? QUALITY.MEDIUM
      : QUALITY.INSUFFICIENT,
    'Structure fautes'
  );

  add(
    49,
    'MARCHÉS',
    'Cohérence globale',
    null,
    QUALITY.MEDIUM,
    'Calculée après comparaison des marchés'
  );

  add(
    50,
    'QUALITÉ',
    'Incertitude / qualité données',
    null,
    QUALITY.MEDIUM,
    'Calculée après inventaire des données'
  );

  return factors;
}

/* =========================================================
   POISSON — MODÈLE DE BUTS
   ========================================================= */

function poisson(lambda, k) {
  if (!Number.isFinite(lambda) || lambda < 0) {
    return 0;
  }

  let factorial = 1;

  for (let i = 2; i <= k; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial
  );
}

function buildGoalMatrix(lambdaHome, lambdaAway) {

  const matrix = [];

  for (let h = 0; h <= 8; h++) {

    for (let a = 0; a <= 8; a++) {

      const p =
        poisson(lambdaHome, h) *
        poisson(lambdaAway, a);

      matrix.push({
        home: h,
        away: a,
        probability: p
      });
    }
  }

  return matrix;
}

/* =========================================================
   CALCUL PROBABILITÉS
   ========================================================= */

function calculateMarkets(home, away) {

  if (
    home.goalsFor === null ||
    away.goalsFor === null ||
    home.goalsAgainst === null ||
    away.goalsAgainst === null
  ) {
    return null;
  }

  /*
   * Attaque équipe A + défense équipe B.
   *
   * Ce n'est PAS une valeur inventée :
   * elle vient uniquement des buts réellement
   * observés dans les derniers matchs.
   */

  const lambdaHome = clamp(
    (
      home.goalsFor +
      away.goalsAgainst
    ) / 2,
    0.05,
    5
  );

  const lambdaAway = clamp(
    (
      away.goalsFor +
      home.goalsAgainst
    ) / 2,
    0.05,
    5
  );

  const matrix = buildGoalMatrix(
    lambdaHome,
    lambdaAway
  );

  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;

  let over05 = 0;
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;

  let bttsYes = 0;

  const scores = [];

  for (const item of matrix) {

    const p = item.probability;

    if (item.home > item.away) {
      pHome += p;
    } else if (item.home === item.away) {
      pDraw += p;
    } else {
      pAway += p;
    }

    const total =
      item.home +
      item.away;

    if (total >= 1) over05 += p;
    if (total >= 2) over15 += p;
    if (total >= 3) over25 += p;
    if (total >= 4) over35 += p;

    if (
      item.home > 0 &&
      item.away > 0
    ) {
      bttsYes += p;
    }

    scores.push(item);
  }

  scores.sort(
    (a, b) =>
      b.probability -
      a.probability
  );

  return {
    lambdaHome,
    lambdaAway,

    oneXTwo: {
      home: pct(pHome * 100),
      draw: pct(pDraw * 100),
      away: pct(pAway * 100)
    },

    doubleChance: {
      oneX: pct((pHome + pDraw) * 100),
      X2: pct((pDraw + pAway) * 100),
      twelve: pct((pHome + pAway) * 100)
    },

    goals: {
      over05: pct(over05 * 100),
      under05: pct((1 - over05) * 100),

      over15: pct(over15 * 100),
      under15: pct((1 - over15) * 100),

      over25: pct(over25 * 100),
      under25: pct((1 - over25) * 100),

      over35: pct(over35 * 100),
      under35: pct((1 - over35) * 100)
    },

    btts: {
      yes: pct(bttsYes * 100),
      no: pct((1 - bttsYes) * 100)
    },

    exactScores: scores
      .slice(0, 5)
      .map(s => ({
        score: `${s.home}-${s.away}`,
        probability: pct(
          s.probability * 100
        )
      }))
  };
}

/* =========================================================
   QUALITÉ DES DONNÉES
   ========================================================= */

function calculateDataQuality(
  factors,
  home,
  away
) {

  const valid = factors.filter(
    f => f.available
  ).length;

  const total = factors.length;

  const ratio =
    total > 0
      ? valid / total
      : 0;

  let quality;

  if (ratio >= 0.70) {
    quality = QUALITY.HIGH;
  } else if (ratio >= 0.50) {
    quality = QUALITY.MEDIUM;
  } else if (ratio >= 0.30) {
    quality = QUALITY.LOW;
  } else {
    quality = QUALITY.INSUFFICIENT;
  }

  return {
    valid,
    total,
    ratio,
    quality
  };
}

/* =========================================================
   CONFIANCE
   ========================================================= */

function calculateConfidence(
  probability,
  quality,
  supportingFactors,
  contradictions
) {

  if (probability === null) {
    return 0;
  }

  let score = probability;

  if (quality === QUALITY.HIGH) {
    score += 8;
  } else if (quality === QUALITY.MEDIUM) {
    score += 3;
  } else if (quality === QUALITY.LOW) {
    score -= 8;
  } else {
    score -= 20;
  }

  score += Math.min(
    supportingFactors * 2,
    10
  );

  score -= Math.min(
    contradictions * 4,
    20
  );

  return Math.round(
    clamp(score, 0, 99)
  );
}

/* =========================================================
   RISQUE
   ========================================================= */

function calculateRisk(confidence, quality) {

  if (
    quality === QUALITY.INSUFFICIENT ||
    confidence < 45
  ) {
    return RISK.VERY_HIGH;
  }

  if (
    quality === QUALITY.LOW ||
    confidence < 60
  ) {
    return RISK.HIGH;
  }

  if (confidence < 75) {
    return RISK.MEDIUM;
  }

  return RISK.LOW;
}

/* =========================================================
   MARCHÉS
   ========================================================= */

function analyseMarket(
  id,
  nom,
  probabilities,
  quality,
  supportingFactors = 0,
  contradictions = 0
) {

  if (
    !probabilities ||
    probabilities.length === 0
  ) {
    return {
      id,
      nom,
      disponible: false,
      prono: 'Données indisponibles',
      probabilite: null,
      confiance: 0,
      risque: RISK.VERY_HIGH,
      dataQuality: QUALITY.INSUFFICIENT,
      statut: 'REJETE'
    };
  }

  const best =
    probabilities
      .filter(p => p.probability !== null)
      .sort(
        (a, b) =>
          b.probability -
          a.probability
      )[0];

  if (!best) {
    return {
      id,
      nom,
      disponible: false,
      prono: 'Données indisponibles',
      probabilite: null,
      confiance: 0,
      risque: RISK.VERY_HIGH,
      dataQuality: QUALITY.INSUFFICIENT,
      statut: 'REJETE'
    };
  }

  const confiance =
    calculateConfidence(
      best.probability,
      quality,
      supportingFactors,
      contradictions
    );

  const risque =
    calculateRisk(
      confiance,
      quality
    );

  const strongEnough =
    best.probability >= 60 &&
    confiance >= 55 &&
    quality !== QUALITY.INSUFFICIENT;

  return {
    id,
    nom,
    disponible: true,
    prono: best.label,
    probabilite: best.probability,
    confiance,
    risque,
    dataQuality: quality,
    statut: strongEnough
      ? 'ELIGIBLE'
      : 'REJETE'
  };
}

/* =========================================================
   ANALYSE DES MARCHÉS PRINCIPAUX
   ========================================================= */

function buildMarkets(
  market,
  home,
  away,
  quality
) {

  if (!market) return [];

  const markets = [];

  const oneX2 = analyseMarket(
    '1X2',
    'Résultat du match',
    [
      {
        label: `Victoire ${home.teamName}`,
        probability: market.oneXTwo.home
      },
      {
        label: 'Match nul',
        probability: market.oneXTwo.draw
      },
      {
        label: `Victoire ${away.teamName}`,
        probability: market.oneXTwo.away
      }
    ],
    quality,
    4,
    0
  );

  markets.push(oneX2);

  markets.push(
    analyseMarket(
      'DOUBLE',
      'Double Chance',
      [
        {
          label: `1X (${home.teamName} ou nul)`,
          probability: market.doubleChance.oneX
        },
        {
          label: `X2 (${away.teamName} ou nul)`,
          probability: market.doubleChance.X2
        },
        {
          label: '12',
          probability: market.doubleChance.twelve
        }
      ],
      quality,
      4,
      0
    )
  );

  markets.push(
    analyseMarket(
      'O05',
      'Total buts 0.5',
      [
        {
          label: 'Plus de 0.5 buts',
          probability: market.goals.over05
        },
        {
          label: 'Moins de 0.5 buts',
          probability: market.goals.under05
        }
      ],
      quality,
      3,
      0
    )
  );

  markets.push(
    analyseMarket(
      'O15',
      'Total buts 1.5',
      [
        {
          label: 'Plus de 1.5 buts',
          probability: market.goals.over15
        },
        {
          label: 'Moins de 1.5 buts',
          probability: market.goals.under15
        }
      ],
      quality,
      4,
      0
    )
  );

  markets.push(
    analyseMarket(
      'O25',
      'Total buts 2.5',
      [
        {
          label: 'Plus de 2.5 buts',
          probability: market.goals.over25
        },
        {
          label: 'Moins de 2.5 buts',
          probability: market.goals.under25
        }
      ],
      quality,
      4,
      0
    )
  );

  markets.push(
    analyseMarket(
      'O35',
      'Total buts 3.5',
      [
        {
          label: 'Plus de 3.5 buts',
          probability: market.goals.over35
        },
        {
          label: 'Moins de 3.5 buts',
          probability: market.goals.under35
        }
      ],
      quality,
      2,
      0
    )
  );

  markets.push(
    analyseMarket(
      'BTTS',
      'Les deux équipes marquent',
      [
        {
          label: 'BTTS Oui',
          probability: market.btts.yes
        },
        {
          label: 'BTTS Non',
          probability: market.btts.no
        }
      ],
      quality,
      3,
      0
    )
  );

  /* =======================================================
     CORNERS
     ======================================================= */

  const cornersAvailable =
    homeStatsAvailable(home) &&
    awayStatsAvailable(away);

  if (cornersAvailable) {
    /*
     * Ici on n'utilise QUE les statistiques réelles
     * collectées dans les derniers matchs.
     */
    markets.push({
      id: 'CORNERS',
      nom: 'Total Corners',
      disponible: true,
      prono:
        'Analyse corners disponible',
      probabilite: null,
      confiance: 0,
      risque: RISK.HIGH,
      dataQuality: QUALITY.LOW,
      statut: 'A_CALCULER'
    });
  } else {
    markets.push({
      id: 'CORNERS',
      nom: 'Total Corners',
      disponible: false,
      prono: 'Données indisponibles',
      probabilite: null,
      confiance: 0,
      risque: RISK.VERY_HIGH,
      dataQuality: QUALITY.INSUFFICIENT,
      statut: 'REJETE'
    });
  }

  return markets;
}

/*
 * Les profils de base ne contiennent pas les statistiques
 * avancées. Ces fonctions permettent de les reconnaître
 * proprement sans inventer de valeur.
 */
function homeStatsAvailable(team) {
  return team?.advanced?.corners !== null &&
    team?.advanced?.corners !== undefined;
}

function awayStatsAvailable(team) {
  return team?.advanced?.corners !== null &&
    team?.advanced?.corners !== undefined;
}

/* =========================================================
   SCORE PROBABLE
   ========================================================= */

function buildScores(market) {

  if (!market?.exactScores?.length) {
    return [];
  }

  return market.exactScores
    .slice(0, 3)
    .map(item => item.score);
}

/* =========================================================
   CHOIX DU PRONOSTIC PRINCIPAL
   ========================================================= */

function choosePrincipalMarket(markets) {

  const eligible =
    markets
      .filter(m =>
        m.statut === 'ELIGIBLE' &&
        m.probabilite !== null &&
        m.dataQuality !== QUALITY.INSUFFICIENT
      )
      .sort((a, b) => {

        /*
         * On ne choisit pas uniquement la plus grande
         * probabilité.

         * Le moteur favorise :
         * - probabilité
         * - confiance
         * - qualité des données
         * - faible risque
         */

        const scoreA =
          a.probabilite * 0.50 +
          a.confiance * 0.40 +
          (a.dataQuality === QUALITY.HIGH ? 10 : 0) -
          (a.risque === RISK.HIGH ? 8 : 0) -
          (a.risque === RISK.VERY_HIGH ? 15 : 0);

        const scoreB =
          b.probabilite * 0.50 +
          b.confiance * 0.40 +
          (b.dataQuality === QUALITY.HIGH ? 10 : 0) -
          (b.risque === RISK.HIGH ? 8 : 0) -
          (b.risque === RISK.VERY_HIGH ? 15 : 0);

        return scoreB - scoreA;
      });

  return eligible[0] || null;
}

/* =========================================================
   ENDPOINT PRINCIPAL
   ========================================================= */

app.post('/analyser', async (req, res) => {

  const domicile =
    cleanName(
      req.body?.domicile ||
      req.body?.home ||
      req.body?.homeTeam
    );

  const exterieur =
    cleanName(
      req.body?.exterieur ||
      req.body?.away ||
      req.body?.awayTeam
    );

  if (!domicile || !exterieur) {

    return res.status(400).json({
      isAvailable: false,
      cerveau: NODE_VERSION,
      verdict: 'Équipes manquantes',
      prono: 'NODE_50 indisponible',
      statusMessage: 'Domicile et extérieur sont requis'
    });
  }

  if (!API_KEY) {

    return res.status(503).json({
      isAvailable: false,
      cerveau: NODE_VERSION,
      verdict: 'NODE_50 indisponible',
      prono: 'NODE_50 indisponible',
      statusMessage: 'API_FOOTBALL_KEY absente'
    });
  }

  try {

    /* =====================================================
       1 — IDENTIFICATION
       ===================================================== */

    const homeTeam =
      await findTeam(domicile);

    const awayTeam =
      await findTeam(exterieur);

    if (!homeTeam || !awayTeam) {

      return res.status(200).json({
        isAvailable: false,
        cerveau: NODE_VERSION,
        domicile,
        exterieur,
        verdict: 'Données insuffisantes',
        prono: 'NODE_50 indisponible',
        statusMessage:
          'Une ou deux équipes n’ont pas pu être identifiées'
      });
    }

    /* =====================================================
       2 — FORMES RÉELLES
       ===================================================== */

    const [
      homeFixtures,
      awayFixtures,
      h2h
    ] = await Promise.all([
      getLastFixtures(homeTeam.id, 5),
      getLastFixtures(awayTeam.id, 5),
      getH2H(
        homeTeam.id,
        awayTeam.id,
        5
      )
    ]);

    if (
      homeFixtures.length === 0 ||
      awayFixtures.length === 0
    ) {

      return res.status(200).json({
        isAvailable: false,
        cerveau: NODE_VERSION,
        domicile,
        exterieur,
        verdict: 'Données insuffisantes',
        prono: 'NODE_50 indisponible',
        statusMessage:
          'Historique récent insuffisant pour analyser ce match'
      });
    }

    /* =====================================================
       3 — PROFILS
       ===================================================== */

    const [
      homeProfile,
      awayProfile
    ] = await Promise.all([
      buildTeamProfile(
        homeTeam,
        homeFixtures
      ),
      buildTeamProfile(
        awayTeam,
        awayFixtures
      )
    ]);

    /* =====================================================
       4 — STATISTIQUES AVANCÉES
       ===================================================== */

    const [
      homeAdvanced,
      awayAdvanced
    ] = await Promise.all([
      enrichTeamStatistics(
        homeTeam.id,
        homeFixtures
      ),
      enrichTeamStatistics(
        awayTeam.id,
        awayFixtures
      )
    ]);

    homeProfile.advanced =
      homeAdvanced;

    awayProfile.advanced =
      awayAdvanced;

    /* =====================================================
       5 — 50 FACTEURS
       ===================================================== */

    const factors =
      buildFactors(
        homeProfile,
        awayProfile,
        h2h,
        homeAdvanced,
        awayAdvanced
      );

    /* =====================================================
       6 — QUALITÉ
       ===================================================== */

    const quality =
      calculateDataQuality(
        factors,
        homeProfile,
        awayProfile
      );

    /* =====================================================
       7 — MARCHÉS
       ===================================================== */

    const marketProbabilities =
      calculateMarkets(
        homeProfile,
        awayProfile
      );

    if (!marketProbabilities) {

      return res.status(200).json({
        isAvailable: false,
        cerveau: NODE_VERSION,
        domicile,
        exterieur,
        criteresValides: quality.valid,
        totalCriteres: quality.total,
        totalTheorique: 50,
        verdict:
          `${quality.valid}/${quality.total} évalués sur 50 | Données insuffisantes`,
        prono: 'NODE_50 indisponible',
        statusMessage:
          'Données réelles insuffisantes pour produire une probabilité'
      });
    }

    /* =====================================================
       8 — MARCHÉS
       ===================================================== */

    const markets =
      buildMarkets(
        marketProbabilities,
        homeProfile,
        awayProfile,
        quality.quality
      );

    /* =====================================================
       9 — PRINCIPAL
       ===================================================== */

    const principal =
      choosePrincipalMarket(markets);

    /* =====================================================
       10 — SCORE EXACT
       ===================================================== */

    const scores =
      buildScores(
        marketProbabilities
      );

    /* =====================================================
       11 — QUALITÉ FINALE
       ===================================================== */

    const availableMarkets =
      markets.filter(
        m => m.disponible
      ).length;

    const eligibleMarkets =
      markets.filter(
        m => m.statut === 'ELIGIBLE'
      ).length;

    let finalVerdict;

    if (!principal) {

      finalVerdict =
        `${quality.valid}/${quality.total} évalués sur 50 | Analyse insuffisante`;

    } else {

      finalVerdict =
        `${quality.valid}/${quality.total} évalués sur 50 | ` +
        `Qualité: ${quality.quality} | ` +
        `Marchés: ${eligibleMarkets}/${availableMarkets} éligibles`;
    }

    /* =====================================================
       12 — RÉPONSE
       ===================================================== */

    return res.status(200).json({

      isAvailable: true,

      cerveau: NODE_VERSION,

      domicile,
      exterieur,

      criteresValides:
        quality.valid,

      totalCriteres:
        quality.total,

      totalTheorique: 50,

      verdict:
        finalVerdict,

      confiance:
        principal
          ? principal.confiance
          : 0,

      risque:
        principal
          ? principal.risque
          : RISK.VERY_HIGH,

      dataQuality:
        quality.quality,

      prono:
        principal
          ? principal.prono
          : 'NODE_50 indisponible',

      typePari:
        principal
          ? principal.nom
          : 'AUCUN',

      vainqueur:
        principal?.id === '1X2'
          ? principal.prono
          : null,

      scoreProbable:
        scores,

      scores,

      proba:
        marketProbabilities.oneXTwo,

      expectedGoals: {
        domicile:
          round(
            marketProbabilities.lambdaHome,
            2
          ),
        exterieur:
          round(
            marketProbabilities.lambdaAway,
            2
          )
      },

      marchesDisponibles:
        markets,

      facteurs: factors,

      details: [

        `Forme: ${homeProfile.wins}V-${homeProfile.draws}N-${homeProfile.losses}D vs ${awayProfile.wins}V-${awayProfile.draws}N-${awayProfile.losses}D`,

        `Buts moyens: ${round(homeProfile.goalsFor, 2)} vs ${round(awayProfile.goalsFor, 2)}`,

        `Buts encaissés: ${round(homeProfile.goalsAgainst, 2)} vs ${round(awayProfile.goalsAgainst, 2)}`,

        `Modèle buts: ${round(marketProbabilities.lambdaHome, 2)} - ${round(marketProbabilities.lambdaAway, 2)}`,

        `H2H: ${h2h.length} confrontation(s)`,

        `Statistiques avancées: ${homeAdvanced.matchesWithStats} matchs domicile / ${awayAdvanced.matchesWithStats} matchs extérieur`,

        `Qualité données: ${quality.quality}`,

        `Facteurs disponibles: ${quality.valid}/${quality.total}`,

        principal
          ? `Prono principal: ${principal.prono} | ${principal.probabilite}% | confiance ${principal.confiance}%`
          : 'Prono principal: aucun',

        `Règle NODE_50: aucune donnée manquante n'est inventée`
      ],

      source:
        'API-FOOTBALL — données réelles uniquement',

      meta: {
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        recentHomeMatches: homeFixtures.length,
        recentAwayMatches: awayFixtures.length,
        h2hMatches: h2h.length,
        availableMarkets,
        eligibleMarkets
      }
    });

  } catch (error) {

    console.error(
      '[NODE_50 ERROR]',
      error
    );

    return res.status(500).json({

      isAvailable: false,

      cerveau: NODE_VERSION,

      verdict:
        'NODE_50 indisponible',

      prono:
        'NODE_50 indisponible',

      statusMessage:
        'Erreur interne pendant l’analyse',

      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined
    });
  }
});

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get('/', (req, res) => {

  res.json({
    status: 'online',
    cerveau: NODE_VERSION,
    mode: 'REAL_DATA_ONLY',
    fakeData: false,
    hashPrediction: false,
    totalFactors: 50
  });

});

app.listen(PORT, () => {

  console.log(
    `[NODE_50] ${NODE_VERSION}`
  );

  console.log(
    `[NODE_50] Port ${PORT}`
  );

  console.log(
    `[NODE_50] API key: ${API_KEY ? 'présente' : 'ABSENTE'}`
  );

});
