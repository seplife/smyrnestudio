# CHOIR AI STUDIO — cœur audio et interface (phases 1-2)

Importer ou enregistrer un morceau, l'analyser réellement, corriger les notes,
exporter MIDI et MusicXML. Aucun résultat simulé. Backend 100 % Node.js.

## Lancer

Prérequis : Node.js 20 ou plus. Le décodeur audio (ffmpeg) est installé
automatiquement par `npm install` ; rien d'autre à installer.

    cd frontend && npm install && npm run build    # compile l'interface
    cd ../backend && npm install && npm start      # application sur http://localhost:8000

En développement : `npm run dev` dans `backend/` et dans `frontend/`
(http://localhost:5173, les appels /api sont relayés vers le port 8000).

    npm test                           # backend : 15 tests
    node src/cli.js morceau.mp3        # analyse.json + melodie.mid + melodie.musicxml

Variables : `PORT`, `CHOIR_DATA` (dossier de stockage), `CHOIR_MAX_MB` (taille
maximale d'un fichier), `CHOIR_WORKERS` (analyses simultanées), `FFMPEG_PATH`
(pour imposer un autre binaire ffmpeg que celui embarqué).

## Backend (backend/)

Fastify pour l'API ; toute l'analyse est écrite en JavaScript, sans bibliothèque
native, et tourne dans des `worker_threads` pour ne pas bloquer le serveur.
ffmpeg (embarqué via le paquet `ffmpeg-static`) sert uniquement à décoder les fichiers.

| Fonction | Méthode | Limite connue |
|---|---|---|
| Import MP3/WAV/FLAC/M4A/AAC/OGG/WebM, MP4/MOV | ffmpeg | l'original n'est jamais modifié |
| Contrôle qualité (saturation, coupures, silence, dynamique) | mesures sur le signal | pas de réduction de bruit |
| Tempo | flux spectral, autocorrélation, suivi de battements (Ellis) | hypothèses moitié/double renvoyées |
| Mesure | autocorrélation des accents | binaire/ternaire seulement, à confirmer |
| Tonalité | Krumhansl-Schmuckler, 3 hypothèses | pas de détection des modulations |
| Accords | gabarits sur chroma par temps | triades majeures/mineures |
| Mélodie | YIN + segmentation en notes | **une seule voix** ; pas de chœur ni de mixage dense |
| Export | écriture directe MIDI et MusicXML 4.0 | quantifié à la double croche |

Chaque résultat porte une `confiance`. Si rien n'est détecté, l'export est
refusé plutôt que de produire une partition vide.

Fichiers : `fft.js`, `audio.js` (décodage, préparation), `analysis.js`,
`melody.js`, `export.js`, `pipeline.js`, `worker.js`, `app.js` (API), `server.js`, `cli.js`.

### API (préfixe /api)

- `GET /projets` → liste
- `POST /projets` (multipart : `fichier`, `titre`) → `{id}` ; analyse lancée en arrière-plan
- `GET /projets/{id}/statut` → progression et étape, ou message d'erreur
- `GET /projets/{id}/analyse` → résultat complet ; `GET /projets/{id}/audio` → copie de travail
- `PATCH /projets/{id}/choix` → tonalité, tempo, mesure retenus pour l'export
- `PUT /projets/{id}/notes` → enregistre l'état complet de l'éditeur
- `POST | PATCH | DELETE /projets/{id}/notes[/{nid}]` → correction note par note
- `GET /projets/{id}/export/midi|musicxml[?bpm=]`
- `DELETE /projets/{id}` → suppression définitive des fichiers

Les erreurs sont renvoyées sous la forme `{ "detail": "message lisible" }`.

## Interface (frontend/)

React, TypeScript, Vite, Tailwind, TanStack Query, Lucide. Trois écrans, tous
branchés sur l'API réelle :

- **Projets** : compteurs, liste, état des analyses en cours, suppression.
- **Nouveau projet** : import par glisser-déposer ou enregistrement au micro
  (pause, reprise, niveau d'entrée, alerte de saturation, réécoute).
- **Projet** : progression de l'analyse ; tonalité, tempo et mesure avec
  confiance et hypothèses sélectionnables (le choix est utilisé à l'export) ;
  éditeur piano roll (déplacer, allonger, ajouter, supprimer, annuler/rétablir,
  enregistrement automatique) ; écoute de l'original et de la mélodie
  transcrite (oscillateur, pas une voix) ; export MIDI et MusicXML.

Raccourcis : Espace (écouter), flèches (déplacer la note), Suppr, Ctrl+Z / Ctrl+Maj+Z.

Les modules non développés ne sont pas des boutons : ils sont listés comme
« prochains modules » et n'apparaîtront dans la navigation qu'une fois fonctionnels.

## Pas encore fait

Authentification, base PostgreSQL, portée musicale à l'écran, file de tâches
persistante (l'état des analyses en cours est en mémoire), séparation des
sources, transcription polyphonique, harmonisation SATB/SATBB, rendu PDF,
synthèse audio.

Conséquence du choix « tout en Node.js » : les modèles d'IA des phases
suivantes (séparation des voix, transcription polyphonique) devront être
exécutés au format ONNX via `onnxruntime-node` (qui sait utiliser un GPU), les
modèles de référence comme Demucs étant publiés pour PyTorch.
