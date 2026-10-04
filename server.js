const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

// 50 CRITERES NODE 50 - CERVEAU COMPLET
function analyserMatch(data) {
  let score = 0;
  let details = [];
  let criteres = 0;

  // 1-10: FORME
  if (data.victoires5 > 3) { score+=8; details.push("Forme excellente +8"); criteres++; }
  if (data.butsMarques > 1.5) { score+=6; details.push("Attaque forte +6"); criteres++; }
  if (data.butsEncaisses < 1) { score+=6; details.push("Defense solide +6"); criteres++; }
  if (data.domicile && data.winRateDom > 60) { score+=7; details.push("Domicile fort +7"); criteres++; }
  if (!data.domicile && data.winRateExt < 30) { score+=-5; details.push("Exterieur faible adversaire +5"); criteres++; }
  if (data.motivation === "haute") { score+=5; details.push("Motivation haute +5"); criteres++; }
  if (data.blessures < 2) { score+=4; details.push("Effectif complet +4"); criteres++; }
  if (data.cartesRouges === 0) { score+=3; details.push("Discipline OK +3"); criteres++; }
  if (data.xG > 1.8) { score+=6; details.push("xG eleve +6"); criteres++; }
  if (data.possession > 55) { score+=4; details.push("Possession maitrisee +4"); criteres++; }

  // 11-20: STATS AVANCEES
  if (data.tirsCadres > 5) { score+=5; details.push("Tirs cadres nombreux +5"); criteres++; }
  if (data.corners > 5) { score+=3; details.push("Corners +3"); criteres++; }
  if (data.h2hWins > 60) { score+=6; details.push("H2H favorable +6"); criteres++; }
  if (data.bttsRate > 60) { score+=4; details.push("BTTS probable +4"); criteres++; }
  if (data.over25Rate > 60) { score+=4; details.push("Over 2.5 probable +4"); criteres++; }
  if (data.cleanSheetRate > 40) { score+=5; details.push("Clean sheet possible +5"); criteres++; }
  if (data.comebackRate > 30) { score+=3; details.push("Mentalite comeback +3"); criteres++; }
  if (data.derniereConfrontation === "victoire") { score+=4; details.push("Confiance H2H +4"); criteres++; }
  if (data.fatigue === "faible") { score+=4; details.push("Fraicheur physique +4"); criteres++; }
  if (data.arbitreSevere === false) { score+=2; details.push("Arbitre tolerant +2"); criteres++; }

  // 21-50: CRITERES SUPPLEMENTAIRES (resume pour efficacite)
  const bonus = [
    data.cote > 1.8 && data.cote < 2.5,
    data.meteo === "bonne",
    data.enjeu === "important",
    data.publicPresent,
    data.entraineurExperimente,
    data.serieInvaincu > 3,
    data.buteurPresent,
    data.milieuCreatif,
    data.pressionMedias === "faible",
    data.voyageAdverseLong,
    data.historiqueButsTardifs,
    data.faiblesseAdverseLaterale,
    data.forceCentrale,
    data.efficaciteCoupFranc > 10,
    data.penaltyRate > 70,
    data.impactRemplaçants,
    data.jeuneTalent,
    data.leaderPresent,
    data.tactiqueAdaptee,
    data.statsDomicileExterieurConfirmees,
    data.coteMouvementFavorable,
    data.volumeMisePublic > 60,
    data.analysePressePositive,
    data.pasDeMatchCoupeProche,
    data.revanche,
    data.stadeRempli,
    data.historiqueArbitreFavorable,
    data.compoTypeAnnoncee,
    data.pasDeRotation,
    data.objectifClair
  ];
  
  bonus.forEach((v,i) => { if(v){ score+=1.5; criteres++; if(i<5) details.push(`Critere bonus ${21+i} valide +1.5`); } });

  let confiance = Math.min(95, Math.max(30, 50 + score));
  let prono = confiance > 75 ? "Victoire FORTE" : confiance > 60 ? "Victoire" : confiance > 50 ? "Double chance" : "A eviter";
  let typePari = confiance > 75 ? "1X2 + Over 1.5" : confiance > 65 ? "1X2" : "Double chance / BTTS";

  return { score: Math.round(score), confiance: Math.round(confiance), criteresValides: criteres, totalCriteres: 50, prono, typePari, details, verdict: `${criteres}/50 criteres valides` };
}

app.get('/', (req,res) => {
  res.json({ status: "NODE_50 LIVE", version: "50 criteres", endpoint: "POST /analyser" });
});

app.post('/analyser', (req,res) => {
  const resultat = analyserMatch(req.body);
  res.json(resultat);
});

app.post('/analyse', (req,res) => {
  const resultat = analyserMatch(req.body);
  res.json(resultat);
});

app.listen(PORT, '0.0.0.0', () => console.log('NODE 50 - 50 criteres en ligne sur ' + PORT));
