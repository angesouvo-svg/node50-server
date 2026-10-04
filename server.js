const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

async function api(path){
  if(!API_KEY) return null;
  const r = await fetch(`https://v3.football.api-sports.io${path}`, { headers: { 'x-apisports-key': API_KEY } });
  const j = await r.json();
  return j.response;
}

// --- CALCUL DES 50 FACTEURS ---
async function calculer50(domicile, exterieur){
  let facteurs = [];
  let pointsDom = 0, pointsExt = 0;
  let evalues = 0, valides = 0, donneesManquantes = 0;

  function add(famille, num, nom, dispo, quiGagne, poids, explication){
    // quiGagne: 'DOM' | 'EXT' | 'NUL' | 'NEUTRE'
    let etat = !dispo ? 'NON ÉVALUÉ' : 'ÉVALUÉ';
    if(dispo){ evalues++; if(quiGagne!=='NEUTRE' && quiGagne!=='NUL'){ valides++; if(quiGagne==='DOM') pointsDom+=poids; else pointsExt+=poids; } }
    else donneesManquantes++;
    facteurs.push({ famille, num, nom, etat, quiGagne, poids, explication });
  }

  // Récupération données
  const tDom = await api(`/teams?search=${encodeURIComponent(domicile)}`);
  const tExt = await api(`/teams?search=${encodeURIComponent(exterieur)}`);
  const idDom = tDom?.[0]?.team?.id;
  const idExt = tExt?.[0]?.team?.id;
  
  const last5Dom = idDom ? await api(`/fixtures?team=${idDom}&last=5`) : null;
  const last5Ext = idExt ? await api(`/fixtures?team=${idExt}&last=5`) : null;
  const h2h = (idDom && idExt) ? await api(`/fixtures/headtohead?h2h=${idDom}-${idExt}&last=5`) : null;
  const injuriesDom = idDom ? await api(`/injuries?team=${idDom}&season=2024`) : null;

  // Helper calcul forme
  function analyseForme(fixtures, teamId){
    if(!fixtures || fixtures.length==0) return null;
    let V=0,N=0,D=0, butsPour=0, butsContre=0, serie=0, regularite=0;
    fixtures.forEach(f=>{
      const isHome = f.teams.home.id===teamId;
      const goalsHome = f.goals.home, goalsAway = f.goals.away;
      const win = f.teams.winner?.id===teamId;
      const draw = f.goals.home===f.goals.away;
      if(win) V++; else if(draw) N++; else D++;
      butsPour += isHome? goalsHome : goalsAway;
      butsContre += isHome? goalsAway : goalsHome;
    });
    return { V,N,D, butsPour, butsContre, avgPour: butsPour/fixtures.length, avgContre: butsContre/fixtures.length, clean: fixtures.filter(f=> (f.teams.home.id===teamId?f.goals.away: f.goals.home)===0).length };
  }

  const fDom = analyseForme(last5Dom, idDom);
  const fExt = analyseForme(last5Ext, idExt);

  // 🟦 A - FORME
  add('A',1,'Forme générale', !!fDom && !!fExt, fDom && fExt ? (fDom.V > fExt.V ? 'DOM':'EXT') : null, 8, fDom? `${domicile} ${fDom.V}V ${fDom.N}N ${fDom.D}D vs ${exterieur} ${fExt?.V||0}V` : 'Pas de data 5 derniers');
  add('A',2,'Forme domicile', !!fDom, fDom?.V>=3?'DOM':'EXT', 7, fDom? `${fDom.V}V à dom, ${fDom.avgPour.toFixed(1)} buts marqués`:'N/A');
  add('A',3,'Forme extérieure', !!fExt, fExt?.D>=3?'DOM':'EXT', 7, fExt? `${fExt.D} défaites à l'ext`:'N/A');
  add('A',4,'Série actuelle', !!fDom, fDom?.V>=3?'DOM':fDom?.D>=3?'EXT':'NUL', 5, fDom? `Série: ${fDom.V}V consécutives?`:'N/A');
  add('A',5,'Régularité', !!fDom, fDom?.V===5?'DOM':'NEUTRE', 4, 'V V V V V vs V D V D V');
  add('A',6,'Buts marqués', !!fDom, fDom?.avgPour>1.5?'DOM':'EXT', 6, `Moy: ${fDom?.avgPour?.toFixed(2)||'?'} vs ${fExt?.avgPour?.toFixed(2)||'?'}`);
  add('A',7,'Buts encaissés', !!fDom, fDom?.avgContre<1.0?'DOM':'EXT', 6, `Moy encaissés: ${fDom?.avgContre?.toFixed(2)}`);
  add('A',8,'Clean sheets', !!fDom, fDom?.clean>=2?'DOM':'EXT', 5, `${fDom?.clean||0} clean sheets /5`);

  // 🟩 B - PUISSANCE
  add('B',9,'xG', !!fDom, fDom?.avgPour>1.2?'DOM':'EXT', 6, 'Approximé par moyenne buts si xG indisponible');
  add('B',10,'xGA', !!fDom, fDom?.avgContre<1.2?'DOM':'EXT', 6, 'Idem xGA');
  add('B',11,'Différentiel xG', !!fDom, (fDom.avgPour - fDom.avgContre) > (fExt.avgPour - fExt.avgContre) ?'DOM':'EXT', 7, `Diff: ${(fDom.avgPour - fDom.avgContre).toFixed(2)}`);
  add('B',12,'Efficacité offensive', !!fDom, 'NEUTRE', 4, 'Buts réels vs xG - surperf à détecter');
  add('B',13,'Efficacité défensive', !!fDom, 'NEUTRE', 4, 'Idem déf');
  add('B',14,'Fréquence de but', !!fDom, fDom.avgPour>0?'DOM':'EXT', 4, 'Marque régulièrement?');
  add('B',15,'Fréquence encaissement', !!fDom, fDom.avgContre<1?'DOM':'EXT', 4, 'Encaisse régulièrement?');
  add('B',16,'BTTS', !!fDom, 'NEUTRE', 3, 'Les deux marquent - à calculer sur 5 matchs');
  add('B',17,'Over 1.5', !!fDom, fDom.avgPour+fDom.avgContre>1.5?'DOM':'EXT', 3, `Fréq >1.5: ${last5Dom?.filter(f=>f.goals.home+f.goals.away>1).length||0}/5`);
  add('B',18,'Over 2.5', !!fDom, 'NEUTRE', 3, 'Idem >2.5');
  add('B',19,'Under 2.5', !!fDom, 'NEUTRE', 3, 'Inverse');
  add('B',20,'Distribution buts', !!fDom, 'NEUTRE', 4, '0,1,2,3,4+ buts');

  // 🟨 C - CONTEXTE
  add('C',21,'Classement', false, null, 5, 'Nécessite standings - non dispo sans league id exact');
  add('C',22,'Écart de niveau', false, null, 5, 'Idem');
  add('C',23,'Enjeu', false, null, 4, 'Titre/maintien/derby - uniquement si data fiable');
  add('C',24,'Repos', !!last5Dom, 'NEUTRE', 3, `Dernier match: ${last5Dom?.[0]?.fixture?.date||'?'}`);
  add('C',25,'Densité calendrier', !!last5Dom, last5Dom?.length>=3?'EXT':'NEUTRE', 3, '3 matchs en 8j ?');
  add('C',26,'Fatigue potentielle', !!last5Dom, 'NEUTRE', 3, 'Objectif uniquement');
  add('C',27,'Absences', !!injuriesDom, injuriesDom?.length>3?'EXT':'DOM', 6, `${injuriesDom?.length||0} blessures listées`);
  add('C',28,'Importance absences', !!injuriesDom, 'NEUTRE', 6, 'Buteur présent? - nécessite analyse effectif');
  add('C',29,'Rotation', false, null, 3, 'Rotation récente - info fiable requise');
  add('C',30,'Continuité équipe', !!fDom, 'NEUTRE', 3, 'Stabilité compo');

  // 🟥 D - H2H
  add('D',31,'H2H général', !!h2h, h2h && h2h.length>0 ? (h2h.filter(f=>f.teams.winner?.id===idDom).length > h2h.filter(f=>f.teams.winner?.id===idExt).length ? 'DOM':'EXT') : 'NEUTRE', 4, `${h2h?.length||0} confrontations récentes`);
  add('D',32,'H2H domicile/extérieur', !!h2h, 'NEUTRE', 4, 'Contexte similaire');
  add('D',33,'Buts H2H', !!h2h, 'NEUTRE', 3, `Moy buts H2H: ${h2h? (h2h.reduce((s,f)=>s+f.goals.home+f.goals.away,0)/h2h.length).toFixed(1):'?'}`);
  add('D',34,'BTTS H2H', !!h2h, 'NEUTRE', 3, 'Fréq BTTS H2H');
  add('D',35,'Over/Under H2H', !!h2h, 'NEUTRE', 3, '⚠️ H2H ne domine jamais - vieux effectifs = poids faible');

  // 🟪 E - STATS MATCH
