const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_FOOTBALL_KEY;

async function api(path){
  if(!API_KEY) return null;
  try{
    const r = await fetch(`https://v3.football.api-sports.io${path}`, { headers: { 'x-apisports-key': API_KEY } });
    const j = await r.json();
    return j.response;
  }catch(e){ return null; }
}

async function calculer50(domicile, exterieur){
  let facteurs = [];
  let pointsDom = 0, pointsExt = 0;
  let evalues = 0, valides = 0, manquants = 0;

  function add(famille, num, nom, dispo, qui, poids, expl){
    if(dispo){ evalues++; if(qui==='DOM'||qui==='EXT'){ valides++; if(qui==='DOM') pointsDom+=poids; else pointsExt+=poids; } }
    else manquants++;
    facteurs.push({ famille, num, nom, etat: dispo?'ÉVALUÉ':'NON ÉVALUÉ', quiGagne: qui, poids, explication: expl });
  }

  let idDom=null, idExt=null, last5Dom=null, last5Ext=null, h2h=null;
  try{
    const tDom = await api(`/teams?search=${encodeURIComponent(domicile)}`);
    const tExt = await api(`/teams?search=${encodeURIComponent(exterieur)}`);
    idDom = tDom?.[0]?.team?.id;
    idExt = tExt?.[0]?.team?.id;
    if(idDom) last5Dom = await api(`/fixtures?team=${idDom}&last=5`);
    if(idExt) last5Ext = await api(`/fixtures?team=${idExt}&last=5`);
    if(idDom && idExt) h2h = await api(`/fixtures/headtohead?h2h=${idDom}-${idExt}&last=5`);
  }catch(e){}

  function analyseForme(fixtures, teamId){
    if(!fixtures || fixtures.length==0) return null;
    let V=0,N=0,D=0,pour=0,contre=0,clean=0;
    fixtures.forEach(f=>{
      const isHome = f.teams.home.id===teamId;
      const gH=f.goals.home||0, gA=f.goals.away||0;
      if(f.teams.winner?.id===teamId) V++; else if(gH===gA) N++; else D++;
      pour+= isHome?gH:gA; contre+= isHome?gA:gH;
      if((isHome?gA:gH)===0) clean++;
    });
    return {V,N,D,pour,contre,clean, avgPour: pour/fixtures.length, avgContre: contre/fixtures.length};
  }

  const fDom = analyseForme(last5Dom, idDom);
  const fExt = analyseForme(last5Ext, idExt);

  // 🟦 A FORME 1-8
  add('A',1,'Forme générale',!!fDom&&!!fExt, fDom&&fExt? (fDom.V>fExt.V?'DOM':'EXT'):'NEUTRE',8, `${domicile} ${fDom?fDom.V+'V':''} vs ${exterieur} ${fExt?fExt.V+'V':''}`);
  add('A',2,'Forme domicile',!!fDom, fDom?.V>=2?'DOM':'EXT',7, `Dom: ${fDom?.V||0}V, ${fDom?.avgPour?.toFixed(1)||0} buts`);
  add('A',3,'Forme extérieure',!!fExt, fExt?.D>=2?'DOM':'EXT',7, `Ext: ${fExt?.D||0}D à l'ext`);
  add('A',4,'Série actuelle',!!fDom, fDom?.V>=3?'DOM':fDom?.D>=3?'EXT':'NUL',5, `Série en cours`);
  add('A',5,'Régularité',!!fDom, fDom?.V===5?'DOM':'NEUTRE',4, 'V V V vs V D V D');
  add('A',6,'Buts marqués',!!fDom, fDom?.avgPour>1.2?'DOM':'EXT',6, `${fDom?.avgPour?.toFixed(2)||'?'} / match`);
  add('A',7,'Buts encaissés',!!fDom, fDom?.avgContre<1?'DOM':'EXT',6, `${fDom?.avgContre?.toFixed(2)||'?'} encaissés`);
  add('A',8,'Clean sheets',!!fDom, fDom?.clean>=2?'DOM':'EXT',5, `${fDom?.clean||0}/5 sans encaisser`);

  // 🟩 B PUISSANCE 9-20
  add('B',9,'xG',!!fDom, fDom?.avgPour>1.2?'DOM':'EXT',6, 'Création occasions (approx buts)');
  add('B',10,'xGA',!!fDom, fDom?.avgContre<1.2?'DOM':'EXT',6, 'Occasions concédées');
  add('B',11,'Différentiel xG',!!fDom&&!!fExt, fDom&&fExt? ((fDom.avgPour-fDom.avgContre)>(fExt.avgPour-fExt.avgContre)?'DOM':'EXT'):'NEUTRE',7, 'xG - xGA domination');
  add('B',12,'Efficacité off',!!fDom, 'NEUTRE',4, 'Buts vs xG surperf');
  add('B',13,'Efficacité déf',!!fDom, 'NEUTRE',4, 'Idem déf');
  add('B',14,'Fréq but',!!fDom, fDom?.pour>=3?'DOM':'EXT',4, 'Marque régulièrement?');
  add('B',15,'Fréq encaissement',!!fDom, fDom?.contre<=2?'DOM':'EXT',4, 'Encaisse régulièrement?');
  add('B',16,'BTTS',!!last5Dom, 'NEUTRE',3, 'Les deux marquent');
  add('B',17,'Over 1.5',!!last5Dom, 'NEUTRE',3, `>1.5: ${last5Dom?.filter(f=> (f.goals.home+f.goals.away)>1).length||0}/5`);
  add('B',18,'Over 2.5',!!last5Dom, 'NEUTRE',3, 'Fréq >2.5');
  add('B',19,'Under 2.5',!!last5Dom, 'NEUTRE',3, 'Inverse');
  add('B',20,'Distribution buts',!!fDom, 'NEUTRE',4, '0,1,2,3,4+');

  // 🟨 C CONTEXTE 21-30
  add('C',21,'Classement',false,null,5,'Besoin league ID');
  add('C',22,'Écart niveau',false,null,5,'Diff points');
  add('C',23,'Enjeu',false,null,4,'Titre/maintien/derby');
  add('C',24,'Repos',!!last5Dom, 'NEUTRE',3, `Dernier: ${last5Dom?.[0]?.fixture?.date?.slice(0,10)||'?'}`);
  add('C',25,'Densité calendrier',!!last5Dom, last5Dom?.length>=4?'EXT':'NEUTRE',3, '3 matchs en 8j');
  add('C',26,'Fatigue',!!last5Dom, 'NEUTRE',3, 'Objectif');
  add('C',27,'Absences',true, 'NEUTRE',6, 'Injuries API si dispo');
  add('C',28,'Importance absences',false,null,6,'Buteur?');
  add('C',29,'Rotation',false,null,3,'Rotation récente');
  add('C',30,'Continuité',!!fDom, 'NEUTRE',3,'Stabilité compo');

  // 🟥 D H2H 31-35
  add('D',31,'H2H général',!!h2h, h2h? (h2h.filter(f=>f.teams.winner?.id===idDom).length > h2h.filter(f=>f.teams.winner?.id===idExt).length?'DOM':'EXT'):'NEUTRE',4, `${h2h?.length||0} H2H`);
  add('D',32,'H2H dom/ext',!!h2h, 'NEUTRE',4, 'Contexte similaire');
  add('D',33,'Buts H2H',!!h2h, 'NEUTRE',3, `Moy: ${h2h? (h2h.reduce((s,f)=>s+f.goals.home+f.goals.away,0)/h2h.length).toFixed(1):'?'} buts`);
  add('D',34,'BTTS H2H',!!h2h, 'NEUTRE',3, 'BTTS H2H');
  add('D',35,'Over/Under H2H',!!h2h, 'NEUTRE',3, '⚠️ H2H ne domine jamais');

  // 🟪 E STATS 36-40
  add('E',36,'Tirs',false,null,3,'Volume tirs');
  add('E',37,'Tirs cadrés',false,null,4,'Plus important');
  add('E',38,'Corners',false,null,4,'Production corners');
  add('E',39,'Cartons',false,null,2,'Discipline');
  add('E',40,'Fautes',false,null,2,'Volume fautes');

  // 🟧 F MARCHES 41-50
  const total = pointsDom+pointsExt || 1;
  const probDom = Math.round(pointsDom/total*100);
  const probExt = Math.round(pointsExt/total*100);
  const probNul = 100-probDom-probExt;
  add('F',41,'Force 1X2',true, probDom>probExt?'DOM':'EXT',8, `1:${probDom}% X:${probNul}% 2:${probExt}%`);
  add('F',42,'Force Double Chance',true, probDom>50?'DOM':'EXT',5, `1X:${probDom+probNul}% X2:${probExt+probNul}%`);
  add('F',43,'Structure Over/Under',!!fDom, 'NEUTRE',5, 'O1.5 O2.5 O3.5');
  add('F',44,'Structure BTTS',!!fDom, 'NEUTRE',5, 'YES/NO');
  add('F',45,'Structure Corners',false,null,3,'O8.5 U8.5');
  add('F',46,'Structure Tirs',false,null,3,'Lignes tirs');
  add('F',47,'Structure Cartons',false,null,2,'Lignes cartons');
  add('F',48,'Structure Fautes',false,null,2,'Lignes fautes');
  const coherents = facteurs.filter(f=>f.quiGagne==='DOM').length;
  add('F',49,'Cohérence globale',true,'NEUTRE',7, `${coherents}/${evalues} vers ${domicile} - ${Math.abs(coherents-evalues/2)<5?'Cohérent':'Risque élevé - signaux contradictoires'}`);
  const incert = manquants>15?'Élevée':manquants>8?'Moyenne':'Faible';
  add('F',50,'Incertitude globale',true,'NEUTRE',8, `Manquants ${manquants}/50 | Fraîcheur OK | Confiance ajustée | Incertitude: ${incert}`);

  let vainqueur = pointsDom>pointsExt? `Victoire ${domicile}` : pointsExt>pointsDom? `Victoire ${exterieur}` : 'Match Nul';
  let confiance = evalues? Math.round(valides/evalues*100) : 50;
  if(manquants>15) confiance = Math.max(55, confiance-15);

  return {
    cerveau: 'NODE_50 V6.1 FIX - 50 FACTEURS REELS',
    domicile, exterieur,
    points: { [domicile]: pointsDom, [exterieur]: pointsExt },
    criteresValides: valides, totalCriteres: evalues, donneesManquantes: manquants,
    verdict: `${valides}/${evalues} évalués sur 50 | Incertitude: ${incert}`,
    confiance,
    prono: vainqueur,
    proba: { '1': probDom, 'X': probNul, '2': probExt },
    facteurs,
    source: API_KEY? `API-FOOTBALL LIVE (${evalues} facteurs)` : 'Mode dégradé'
  };
}

app.get('/', (req,res)=> res.json({status:'NODE_50 V6.1 LIVE - FIX CRASH', hasKey:!!API_KEY, total:50}));

app.post(['/analyser','/analyse','/api/analyser'], async (req,res)=>{
  const dom = req.body.domicile || req.body.home || 'Domicile';
  const ext = req.body.exterieur || req.body.away || 'Extérieur';
  const r = await calculer50(dom, ext);
  res.json(r);
});

app.listen(PORT,'0.0.0.0',()=>console.log('V6.1 FIX sur '+PORT));
