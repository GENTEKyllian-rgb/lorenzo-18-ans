
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import './App.css';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'webp',
  'mp4', 'mov', 'webm',
];

const actions = [
  {
    icon: '📸',
    title: 'Récolter les souvenirs',
    description: 'Dépose tes photos et vidéos de la soirée',
    color: 'green',
    type: 'photos',
  },
  {
    icon: '💌',
    title: 'Le carnet du fermier',
    description: 'Laisse un petit mot pour Lorenzo',
    color: 'yellow',
    type: 'messages',
  },
  {
    icon: '🎵',
    title: 'Commander la musique',
    description: 'Une musique ou une dédicace ?',
    color: 'green',
    type: 'requests',
  },
  {
    icon: '🎥',
    title: 'Le confessionnal agricole',
    description: '30 secondes pour raconter tes exploits',
    color: 'yellow',
    type: 'video',
  },
];

function FilePreview({ file }) {
  const [preview, setPreview] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (file.type.startsWith('image/')) {
    return (
      <img
        className="file-thumbnail"
        src={preview}
        alt={file.name}
      />
    );
  }

  return (
    <div className="video-thumbnail">
      <span>🎬</span>
      <small>VIDÉO</small>
    </div>
  );
}

function App() {
  const [page, setPage] = useState('home');

  // Confessionnal agricole : caméra et enregistrement vidéo
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const recordedUrlRef = useRef('');
  const [confessionFirstname, setConfessionFirstname] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);

  // Carnet du fermier
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [content, setContent] = useState('');

  // Commandes musicales
  const [requestFirstname, setRequestFirstname] = useState('');
  const [musicTitle, setMusicTitle] = useState('');
  const [musicArtist, setMusicArtist] = useState('');
  const [dedication, setDedication] = useState('');

  // Envoi des souvenirs
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Messages et chargement
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function openPage(type) {
    setNotice('');
    setError('');

    if (
      type === 'messages' ||
      type === 'photos' ||
      type === 'requests' ||
      type === 'video'
    ) {
      setPage(type);
    }
  }

  // Arrêter proprement la caméra et le chronomètre
  function stopCamera() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Laisser MediaRecorder terminer et livrer son dernier bloc avant
    // d'arrêter les pistes de la caméra (sinon le fichier peut être vide).
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      return;
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    setCameraActive(false);
    setRecording(false);
  }

  function clearRecordedVideo() {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = '';
    }

    setRecordedUrl('');
    setRecordedBlob(null);
    setSecondsLeft(30);
  }

  // Éteindre la caméra si l'invité quitte le confessionnal ou la page
  useEffect(() => {
    if (page !== 'video') {
      stopCamera();
    }
  }, [page]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (recordedUrlRef.current) {
        URL.revokeObjectURL(recordedUrlRef.current);
      }
    };
  }, []);

  async function activateCamera() {
    setError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Ton navigateur ne permet pas d'accéder à la caméra. Utilise un navigateur récent et une connexion sécurisée (HTTPS).");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: 'user',
        },
        audio: true,
      });

      cameraStreamRef.current = stream;
      setCameraActive(true);

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
    } catch (err) {
      console.error('Erreur caméra/micro :', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError("L'accès à la caméra ou au micro a été refusé. Autorise-les dans les paramètres de ton navigateur puis réessaie.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError("Aucune caméra ou aucun micro n'a été détecté sur cet appareil.");
      } else {
        setError("Impossible d'activer la caméra. Vérifie qu'elle n'est pas déjà utilisée par une autre application.");
      }
    }
  }

  function startRecording() {
    if (!cameraStreamRef.current) {
      setError('Active d’abord la caméra et le micro.');
      return;
    }

    setError('');
    clearRecordedVideo();
    recordingChunksRef.current = [];

    // VP8 est généralement plus tolérant sur les webcams Windows/Edge.
    const mimeCandidates = [
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
    ];
    const supportedMime = mimeCandidates.find((type) =>
      window.MediaRecorder && MediaRecorder.isTypeSupported(type)
    );

    try {
      const options = supportedMime
        ? { mimeType: supportedMime, videoBitsPerSecond: 2000000, audioBitsPerSecond: 128000 }
        : { videoBitsPerSecond: 2000000, audioBitsPerSecond: 128000 };
      const recorder = new MediaRecorder(cameraStreamRef.current, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error('Erreur MediaRecorder :', event.error);
        setError("Une erreur est survenue pendant l'enregistrement. Réessaie.");
        setRecording(false);
      };

      recorder.onstop = () => {
        // Les données finales sont émises avant l'événement stop.
        const mimeType = recorder.mimeType || 'video/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        recordingChunksRef.current = [];

        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach((track) => track.stop());
          cameraStreamRef.current = null;
        }
        setCameraActive(false);
        setRecording(false);

        if (blob.size === 0) {
          setError("Le navigateur n'a transmis aucune donnée vidéo. Essaie à nouveau, ou teste avec Chrome/Edge à jour.");
          return;
        }

        if (blob.size > MAX_FILE_SIZE) {
          setError('La vidéo dépasse la limite de 50 Mo. Réessaie avec une vidéo plus courte ou une qualité plus faible.');
          return;
        }

        const url = URL.createObjectURL(blob);
        recordedUrlRef.current = url;
        setRecordedBlob(blob);
        setRecordedUrl(url);
        setSecondsLeft(30);
      };

      recorder.start(250);
      setRecording(true);
      setSecondsLeft(30);

      let remaining = 30;
      recordingTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        setSecondsLeft(remaining);
        if (remaining <= 0) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
          if (recorder.state !== 'inactive') recorder.stop();
        }
      }, 1000);
    } catch (err) {
      console.error('Impossible de démarrer MediaRecorder :', err);
      setError("Ton navigateur ne prend pas en charge l'enregistrement vidéo. Essaie avec Chrome ou Edge à jour.");
    }
  }

  function stopRecordingManually() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      // onstop s'occupe de fermer la caméra après réception du dernier bloc.
      mediaRecorderRef.current.stop();
      return;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
    setRecording(false);
  }

  async function uploadConfession() {
    if (!confessionFirstname.trim()) {
      setError('Indique ton prénom avant d’envoyer ta vidéo.');
      return;
    }
    if (!recordedBlob) {
      setError('Enregistre d’abord ta vidéo.');
      return;
    }
    if (confessionFirstname.trim().length > 50) {
      setError('Ton prénom ne doit pas dépasser 50 caractères.');
      return;
    }

    setError('');
    setVideoUploading(true);

    try {
      const extension = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm';
      const fileName = `confession-${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const filePath = `souvenirs/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('souvenirs')
        .upload(filePath, recordedBlob, {
          cacheControl: '3600',
          upsert: false,
          contentType: recordedBlob.type || 'video/webm',
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('requests')
        .insert([
          {
            firstname: confessionFirstname.trim(),
            request_type: 'confession',
            content: `Vidéo : ${filePath}`,
          },
        ]);

      if (insertError) throw insertError;

      stopCamera();
      clearRecordedVideo();
      setConfessionFirstname('');
      setNotice('🎥 Ta confession agricole a bien été envoyée à Lorenzo !');
      setPage('home');
    } catch (err) {
      console.error('Erreur lors de l’envoi de la confession :', err);
      setError("Impossible d'envoyer ta vidéo. Vérifie ta connexion et réessaie.");
    } finally {
      setVideoUploading(false);
    }
  }

  // Envoyer un message dans le carnet du fermier
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!firstname.trim() || !lastname.trim() || !content.trim()) {
      setError('Merci de remplir tous les champs !');
      return;
    }

    if (
      firstname.trim().length > 50 ||
      lastname.trim().length > 50 ||
      content.trim().length > 1000
    ) {
      setError('Un des champs dépasse la longueur autorisée.');
      return;
    }

    setLoading(true);

    try {
      const { error: insertError } = await supabase
        .from('messages')
        .insert([
          {
            firstname: firstname.trim(),
            lastname: lastname.trim(),
            content: content.trim(),
          },
        ]);

      if (insertError) throw insertError;

      setFirstname('');
      setLastname('');
      setContent('');
      setNotice('💌 Ton message a bien été récolté ! Merci !');
      setPage('home');
    } catch (err) {
      console.error('Erreur lors de l’envoi :', err);
      setError("Impossible d'envoyer ton message. Réessaie dans un instant.");
    } finally {
      setLoading(false);
    }
  }

  // Envoyer une demande musicale dans Supabase
  async function handleMusicSubmit(event) {
    event.preventDefault();
    setError('');

    if (
      !requestFirstname.trim() ||
      !musicTitle.trim() ||
      !musicArtist.trim()
    ) {
      setError('Merci de remplir ton prénom, le titre et l’artiste !');
      return;
    }

    const musicContent =
      `Titre : ${musicTitle.trim()}\n` +
      `Artiste : ${musicArtist.trim()}\n` +
      `Dédicace : ${dedication.trim() || 'Aucune'}`;

    if (musicContent.length > 500) {
      setError('Ta demande est trop longue. Raccourcis un peu les champs.');
      return;
    }

    setLoading(true);

    try {
      const { error: insertError } = await supabase
        .from('requests')
        .insert([
          {
            firstname: requestFirstname.trim(),
            request_type: 'musique',
            content: musicContent,
          },
        ]);

      if (insertError) throw insertError;

      setRequestFirstname('');
      setMusicTitle('');
      setMusicArtist('');
      setDedication('');

      setNotice('🎵 Ta demande musicale a bien été envoyée !');
      setPage('home');
    } catch (err) {
      console.error('Erreur lors de la demande musicale :', err);
      setError("Impossible d'envoyer ta demande. Réessaie dans un instant.");
    } finally {
      setLoading(false);
    }
  }

  // Sélectionner des photos et vidéos
  function handleFileSelection(event) {
    setError('');

    const files = Array.from(event.target.files || []);

    if (files.length === 0) return;

    for (const file of files) {
      const extension = file.name.split('.').pop().toLowerCase();

      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        setError(`Le format du fichier "${file.name}" n'est pas accepté.`);
        event.target.value = '';
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" dépasse la limite de 50 Mo.`);
        event.target.value = '';
        return;
      }
    }

    setSelectedFiles((previous) => [...previous, ...files]);
    event.target.value = '';
  }

  function removeFile(index) {
    setSelectedFiles((previous) =>
      previous.filter((_, fileIndex) => fileIndex !== index)
    );
  }

  // Envoyer les fichiers dans le bucket Supabase
  async function uploadFiles() {
    if (selectedFiles.length === 0) {
      setError('Sélectionne au moins un souvenir !');
      return;
    }

    setError('');
    setUploading(true);
    setUploadProgress(0);

    let uploadedCount = 0;
    const totalFiles = selectedFiles.length;

    try {
      for (const file of selectedFiles) {
        const safeName = file.name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9._-]/g, '_');

        const uniqueName =
          `${Date.now()}-${crypto.randomUUID()}-${safeName}`;

        const filePath = `souvenirs/${uniqueName}`;

        const { error: uploadError } = await supabase.storage
          .from('souvenirs')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type,
          });

        if (uploadError) throw uploadError;

        uploadedCount++;

        setSelectedFiles((previous) =>
          previous.filter((item) => item !== file)
        );

        setUploadProgress(
          Math.round((uploadedCount / totalFiles) * 100)
        );
      }

      setNotice(
        `📸 ${uploadedCount} souvenir(s) envoyé(s) avec succès ! Merci !`
      );

      setPage('home');
      setUploadProgress(0);
    } catch (err) {
      console.error('Erreur lors du dépôt :', err);

      setError(
        uploadedCount > 0
          ? `${uploadedCount} fichier(s) envoyé(s). Certains fichiers n'ont pas pu être envoyés. Tu peux réessayer avec ceux qui restent.`
          : "Impossible d'envoyer les fichiers. Vérifie ta connexion et réessaie."
      );
    } finally {
      setUploading(false);
    }
  }

  function formatFileSize(bytes) {
    return bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} Ko`
      : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-overlay">
          <div className="top-label">
            🌾 ÉDITION SPÉCIALE • GRANDE MOISSON 🌾
          </div>

          <div className="hero-title">
            <span className="tractor">🚜</span>
            <h1>LORENZO</h1>
            <h2>18 ANS !</h2>
          </div>

          <div className="hero-message">
            <span>LA MOISSON DES SOUVENIRS</span>
            <p>Ce soir, on récolte les meilleurs dossiers !</p>
          </div>

          <div className="wheat-decoration">
            🌾 🌻 🌾 🌻 🌾
          </div>
        </div>
      </header>

      <main className="main-content">
        {page === 'home' && (
          <>
            {notice && (
              <div className="success-notice">
                <span>{notice}</span>
                <button
                  type="button"
                  onClick={() => setNotice('')}
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>
            )}

            <div className="section-heading">
              <span>🚜</span>
              <div>
                <h3>Bienvenue à la ferme !</h3>
                <p>Choisis ton activité pour la soirée</p>
              </div>
            </div>

            <div className="actions">
              {actions.map((action) => (
                <button
                  className={`action-card ${action.color}`}
                  key={action.type}
                  onClick={() => openPage(action.type)}
                >
                  <span className="action-icon">{action.icon}</span>

                  <span className="action-text">
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>

                  <span className="action-arrow">›</span>
                </button>
              ))}
            </div>

            <div className="bottom-message">
              <div className="bottom-icon">🌻</div>
              <p>18 ANS, ÇA SE FÊTE !</p>
              <span>Une récolte exceptionnelle de souvenirs.</span>
            </div>
          </>
        )}

        {page === 'messages' && (
          <section className="guestbook">
            <button
              type="button"
              className="back-button"
              onClick={() => setPage('home')}
            >
              ← Retour à l'accueil
            </button>

            <div className="guestbook-heading">
              <span>💌</span>
              <h3>Le carnet du fermier</h3>
              <p>Un petit mot pour le jeune exploitant !</p>
            </div>

            <form className="message-form" onSubmit={handleSubmit}>
              <label htmlFor="firstname">Ton prénom</label>
              <input
                id="firstname"
                type="text"
                placeholder="Ex : Thomas"
                value={firstname}
                onChange={(e) => setFirstname(e.target.value)}
                maxLength={50}
                required
              />

              <label htmlFor="lastname">Ton nom</label>
              <input
                id="lastname"
                type="text"
                placeholder="Ex : Dupont"
                value={lastname}
                onChange={(e) => setLastname(e.target.value)}
                maxLength={50}
                required
              />

              <label htmlFor="content">Ton message</label>
              <textarea
                id="content"
                placeholder="Écris ton petit mot pour Lorenzo..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={1000}
                rows={5}
                required
              />

              <div className="character-count">
                {content.length}/1000 caractères
              </div>

              {error && <div className="error-message">{error}</div>}

              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading ? 'ENVOI EN COURS...' : 'ENVOYER MON MESSAGE 🌾'}
              </button>
            </form>
          </section>
        )}

        {page === 'requests' && (
          <section className="guestbook">
            <button
              type="button"
              className="back-button"
              onClick={() => setPage('home')}
              disabled={loading}
            >
              ← Retour à l'accueil
            </button>

            <div className="guestbook-heading">
              <span>🎵</span>
              <h3>Commander la musique</h3>
              <p>Fais passer ton son préféré pour Lorenzo !</p>
            </div>

            <form className="message-form" onSubmit={handleMusicSubmit}>
              <label htmlFor="requestFirstname">Ton prénom</label>
              <input
                id="requestFirstname"
                type="text"
                placeholder="Ex : Thomas"
                value={requestFirstname}
                onChange={(e) => setRequestFirstname(e.target.value)}
                maxLength={50}
                required
              />

              <label htmlFor="musicTitle">Titre de la musique</label>
              <input
                id="musicTitle"
                type="text"
                placeholder="Ex : Les lacs du Connemara"
                value={musicTitle}
                onChange={(e) => setMusicTitle(e.target.value)}
                maxLength={180}
                required
              />

              <label htmlFor="musicArtist">Artiste</label>
              <input
                id="musicArtist"
                type="text"
                placeholder="Ex : Michel Sardou"
                value={musicArtist}
                onChange={(e) => setMusicArtist(e.target.value)}
                maxLength={120}
                required
              />

              <label htmlFor="dedication">
                Une petite dédicace (facultatif)
              </label>
              <textarea
                id="dedication"
                placeholder="Un petit message pour accompagner ta musique..."
                value={dedication}
                onChange={(e) => setDedication(e.target.value)}
                maxLength={100}
                rows={3}
              />

              {error && <div className="error-message">{error}</div>}

              <button
                type="submit"
                className="submit-button"
                disabled={loading}
              >
                {loading ? 'ENVOI EN COURS...' : 'ENVOYER MA DEMANDE 🎵'}
              </button>
            </form>
          </section>
        )}

        {page === 'photos' && (
          <section className="guestbook">
            <button
              type="button"
              className="back-button"
              onClick={() => {
                setPage('home');
                setError('');
              }}
              disabled={uploading}
            >
              ← Retour à l'accueil
            </button>

            <div className="guestbook-heading">
              <span>📸</span>
              <h3>Récolter les souvenirs</h3>
              <p>Partage tes plus beaux moments avec Lorenzo !</p>
            </div>

            <div className="upload-information">
              <strong>🌾 La récolte est ouverte !</strong>
              <p>
                Sélectionne tes photos et vidéos pour les partager
                avec tout le monde.
              </p>
              <small>
                Formats acceptés : JPG, PNG, WEBP, MP4, MOV et WEBM.
                50 Mo maximum par fichier.
              </small>
            </div>

            <label className="file-picker">
              <span className="file-picker-icon">📂</span>
              <strong>Choisir mes souvenirs</strong>
              <small>Photos et vidéos depuis ton téléphone</small>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
                multiple
                onChange={handleFileSelection}
                disabled={uploading}
              />
            </label>

            {selectedFiles.length > 0 && (
              <div className="selected-files">
                <h4>Mes souvenirs ({selectedFiles.length})</h4>

                {selectedFiles.map((file, index) => (
                  <div
                    className="selected-file"
                    key={`${file.name}-${index}`}
                  >
                    <FilePreview file={file} />

                    <div className="selected-file-info">
                      <strong>{file.name}</strong>
                      <small>{formatFileSize(file.size)}</small>
                    </div>

                    <button
                      type="button"
                      className="remove-file"
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                      aria-label="Retirer ce fichier"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="error-message">{error}</div>}

            {uploading && (
              <div className="upload-status">
                <p>Récolte en cours... {uploadProgress}%</p>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              className="submit-button"
              onClick={uploadFiles}
              disabled={uploading || selectedFiles.length === 0}
            >
              {uploading
                ? 'ENVOI EN COURS...'
                : 'ENVOYER MES SOUVENIRS 🌾'}
            </button>
          </section>
        )}
        {page === 'video' && (
          <section className="guestbook">
            <button
              type="button"
              className="back-button"
              onClick={() => {
                stopCamera();
                clearRecordedVideo();
                setError('');
                setPage('home');
              }}
              disabled={videoUploading}
            >
              ← Retour à l'accueil
            </button>

            <div className="guestbook-heading">
              <span>🎥</span>
              <h3>Le confessionnal agricole</h3>
              <p>30 secondes pour raconter tes exploits à Lorenzo !</p>
            </div>

            <div className="upload-information">
              <strong>🎬 À toi la parole !</strong>
              <p>Autorise la caméra et le micro, puis enregistre ton message vidéo. L'enregistrement s'arrête automatiquement au bout de 30 secondes.</p>
              <small>Ta vidéo sera envoyée directement dans le coffre-fort des souvenirs de Lorenzo. 50 Mo maximum.</small>
            </div>

            <form
              className="message-form"
              onSubmit={(event) => event.preventDefault()}
            >
              <label htmlFor="confessionFirstname">Ton prénom</label>
              <input
                id="confessionFirstname"
                type="text"
                placeholder="Ex : Thomas"
                value={confessionFirstname}
                onChange={(event) => setConfessionFirstname(event.target.value)}
                maxLength={50}
                required
                disabled={videoUploading}
              />
            </form>

            {recordedUrl ? (
              <div style={{ marginTop: 18 }}>
                <p style={{ fontWeight: 700, marginBottom: 10, color: '#31533b' }}>Voici ta vidéo !</p>
                <video
                  src={recordedUrl}
                  controls
                  playsInline
                  style={{ width: '100%', maxHeight: 420, borderRadius: 16, background: '#17251b' }}
                />
                <button
                  type="button"
                  className="submit-button"
                  style={{ marginTop: 14 }}
                  onClick={uploadConfession}
                  disabled={videoUploading || !confessionFirstname.trim()}
                >
                  {videoUploading ? 'ENVOI DE LA VIDÉO...' : 'ENVOYER MA CONFESSION 🎥'}
                </button>
                <button
                  type="button"
                  className="back-button"
                  style={{ marginTop: 12, width: '100%', textAlign: 'center' }}
                  onClick={() => {
                    clearRecordedVideo();
                    setError('');
                    activateCamera();
                  }}
                  disabled={videoUploading}
                >
                  ↻ Recommencer la vidéo
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 18 }}>
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{
                    display: cameraActive ? 'block' : 'none',
                    width: '100%',
                    maxHeight: 420,
                    borderRadius: 16,
                    background: '#17251b',
                    transform: 'scaleX(-1)',
                    objectFit: 'cover',
                    filter: 'none',
                  }}
                />
                {!cameraActive && !recording && (
                  <div style={{
                    minHeight: 190,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    borderRadius: 16,
                    background: '#edf2e8',
                    color: '#31533b',
                    textAlign: 'center',
                    padding: 20,
                  }}>
                    <span style={{ fontSize: 48 }}>📷</span>
                    <strong>Ta caméra est au repos</strong>
                    <span>Active-la pour te voir à l'écran.</span>
                  </div>
                )}

                {recording && (
                  <div style={{ textAlign: 'center', marginTop: 12, color: '#b52d2d', fontWeight: 800 }}>
                    <span>🔴 ENREGISTREMENT EN COURS</span>
                    <div style={{ fontSize: 30, marginTop: 4 }}>{`00:${String(secondsLeft).padStart(2, '0')}`}</div>
                  </div>
                )}

                {!cameraActive && !recording ? (
                  <button
                    type="button"
                    className="submit-button"
                    style={{ marginTop: 14 }}
                    onClick={activateCamera}
                    disabled={videoUploading}
                  >
                    ACTIVER LA CAMÉRA ET LE MICRO 📷
                  </button>
                ) : null}

                {cameraActive && !recording && (
                  <button
                    type="button"
                    className="submit-button"
                    style={{ marginTop: 14 }}
                    onClick={startRecording}
                    disabled={videoUploading}
                  >
                    🔴 COMMENCER L'ENREGISTREMENT
                  </button>
                )}

                {recording && (
                  <button
                    type="button"
                    className="submit-button"
                    style={{ marginTop: 14, background: '#a93636' }}
                    onClick={stopRecordingManually}
                  >
                    TERMINER L'ENREGISTREMENT
                  </button>
                )}
              </div>
            )}

            {error && <div className="error-message" style={{ marginTop: 16 }}>{error}</div>}
          </section>
        )}

      </main>

      <footer>
        <span>🚜</span>
        FAIT AVEC ❤️ POUR LES 18 ANS DE LORENZO
        <span>🌾</span>
      </footer>
    </div>
  );
}

export default App;
