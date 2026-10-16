import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowLeft, BarChart3, Check, CircleHelp, Crown, Gift, Lock, LogIn, LogOut, Monitor, Plus, Radio, RefreshCw, ShieldCheck, Sparkles, Trophy, Users, X } from 'lucide-react';

const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
};
const fmtDate = v => v ? new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const statusLabel = { draft: 'Bản nháp', open: 'Đang mở', locked: 'Đã khóa', resolved: 'Đã công bố', cancelled: 'Đã hủy' };
const statusClass = { draft: 'muted', open: 'live', locked: 'locked', resolved: 'done', cancelled: 'muted' };

function useRealtime(token, isAdmin, roomId, onState) {
  useEffect(() => {
    if (!token) return;
    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    if (isAdmin && roomId) socket.emit('admin:watch', roomId);
    const handler = state => onState(state);
    socket.on(isAdmin ? 'room:update' : 'player:update', handler);
    socket.on('room:closed', () => onState(null));
    return () => socket.disconnect();
  }, [token, isAdmin, roomId, onState]);
}

function App() {
  const [page, setPage] = useState(() => { const joinCode = new URLSearchParams(window.location.search).get('join'); return joinCode ? 'join' : (localStorage.getItem('vmc_admin_token') ? 'admin' : (localStorage.getItem('vmc_player_token') ? 'player' : 'home')); });
  const [adminToken, setAdminToken] = useState(localStorage.getItem('vmc_admin_token') || '');
  const [playerToken, setPlayerToken] = useState(localStorage.getItem('vmc_player_token') || '');
  const [playerInfo, setPlayerInfo] = useState(JSON.parse(localStorage.getItem('vmc_player_info') || 'null'));
  const [lastJoin, setLastJoin] = useState(JSON.parse(localStorage.getItem('vmc_last_join') || 'null'));
  const [roomState, setRoomState] = useState(null);
  const [adminRooms, setAdminRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(localStorage.getItem('vmc_admin_room') || '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAdminRooms = useCallback(async () => {
    if (!adminToken) return;
    try {
      const data = await api('/api/admin/rooms', { token: adminToken });
      setAdminRooms(data.rooms);
      if (!selectedRoom && data.rooms[0]) setSelectedRoom(data.rooms[0].id);
    } catch (e) { setError(e.message); }
  }, [adminToken, selectedRoom]);

  const refreshState = useCallback(async () => {
    try {
      if (adminToken && selectedRoom) {
        const data = await api(`/api/admin/rooms/${selectedRoom}/state`, { token: adminToken });
        setRoomState(data);
      } else if (playerToken) {
        const data = await api('/api/player/state', { token: playerToken });
        setRoomState(data);
      }
    } catch (e) { setError(e.message); }
  }, [adminToken, selectedRoom, playerToken]);

  useEffect(() => { loadAdminRooms(); }, [loadAdminRooms]);
  useEffect(() => {
    if (adminToken && selectedRoom) { localStorage.setItem('vmc_admin_room', selectedRoom); refreshState(); }
    else if (playerToken) refreshState();
  }, [adminToken, selectedRoom, playerToken, refreshState]);

  const onRealtimeState = useCallback(state => {
    if (state) setRoomState(state);
    else { setRoomState(null); setError('Phòng đã đóng hoặc kết nối bị gián đoạn.'); }
  }, []);
  useRealtime(adminToken, true, selectedRoom, onRealtimeState);
  useRealtime(playerToken, false, '', onRealtimeState);

  const clearMessages = () => { setError(''); setNotice(''); };
  const logoutAdmin = () => { localStorage.removeItem('vmc_admin_token'); setAdminToken(''); setRoomState(null); setPage('home'); clearMessages(); };
  const logoutPlayer = () => { localStorage.removeItem('vmc_player_token'); setPlayerToken(''); setRoomState(null); setPage('join'); clearMessages(); setNotice('Bạn đã đăng xuất khỏi thiết bị này. Điểm và tên trong phòng vẫn được giữ; nhập lại tên cùng mã khôi phục để vào tiếp.'); };

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => setPage('home')} aria-label="Trang chủ">
        <span className="brand-mark"><img src="/logo.svg" alt="" onError={e => { e.currentTarget.style.display='none'; const fallback=e.currentTarget.nextElementSibling; if (fallback) fallback.style.display='block'; }}/><Activity className="brand-fallback" size={21}/></span>
        <span><b>VMC</b><small>LIVE PREDICTION</small></span>
      </button>
      <div className="topbar-right">
        <span className="connection"><span className="pulse-dot"/> LIVE EVENT PLATFORM</span>
        {adminToken && <button className="btn btn-ghost btn-small" onClick={logoutAdmin}><LogOut size={15}/> Đăng xuất admin</button>}
        {playerToken && <button className="btn btn-ghost btn-small" onClick={logoutPlayer}><LogOut size={15}/> Đăng xuất</button>}
      </div>
    </header>
    {error && <div className="alert alert-error"><X size={17}/><span>{error}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
    {notice && <div className="alert alert-success"><Check size={17}/><span>{notice}</span><button onClick={() => setNotice('')}><X size={16}/></button></div>}
    {page === 'home' && !adminToken && !playerToken && <Home onAdmin={() => { setPage('admin-login'); clearMessages(); }} onJoin={() => { setPage('join'); clearMessages(); }} />}
    {page === 'admin-login' && <AdminLogin onBack={() => setPage('home')} onSuccess={token => { localStorage.setItem('vmc_admin_token', token); setAdminToken(token); setPage('admin'); setNotice('Đăng nhập quản trị thành công.'); }} />}
    {adminToken && page !== 'home' && <AdminApp token={adminToken} rooms={adminRooms} selectedRoom={selectedRoom} setSelectedRoom={setSelectedRoom} state={roomState} onRefresh={async () => { await loadAdminRooms(); await refreshState(); }} onState={setRoomState} setError={setError} setNotice={setNotice} />}
    {page === 'join' && !playerToken && <JoinRoom remembered={lastJoin} onBack={() => setPage('home')} onSuccess={(token, info, state, resumed, joinDetails) => { localStorage.setItem('vmc_player_token', token); localStorage.setItem('vmc_player_info', JSON.stringify(info)); localStorage.setItem('vmc_last_join', JSON.stringify(joinDetails)); setLastJoin(joinDetails); setPlayerToken(token); setPlayerInfo(info); setRoomState(state); setPage('player'); setNotice(resumed ? 'Đã khôi phục người chơi! Điểm và lịch sử của bạn vẫn còn nguyên.' : 'Bạn đã vào phòng thành công! Hãy nhớ mã khôi phục 6 số để quay lại sau này.'); }} />}
    {playerToken && <PlayerApp token={playerToken} info={playerInfo} state={roomState} onRefresh={refreshState} onState={setRoomState} setError={setError} setNotice={setNotice} />}
    <footer className="footer"><span>VMC LIVE PREDICTION</span><span>Made for the MLBB community · Realtime event companion</span></footer>
  </div>;
}

function Home({ onAdmin, onJoin }) {
  return <main className="landing page-width">
    <div className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><span className="pulse-dot"/> COMMUNITY EVENT TOOL</div>
        <h1>Dự đoán trận đấu.<br/><span>Chiếm lấy bảng xếp hạng.</span></h1>
        <p>Mini game realtime dành cho viewing party MLBB. Dự đoán tình huống, săn điểm underdog và cạnh tranh cùng cộng đồng.</p>
        <div className="hero-actions"><button className="btn btn-primary btn-lg" onClick={onJoin}><LogIn size={18}/> Vào phòng chơi</button><button className="btn btn-secondary btn-lg" onClick={onAdmin}><ShieldCheck size={18}/> Quản trị sự kiện</button></div>
        <div className="hero-stats"><div><b>REALTIME</b><span>Cập nhật tức thì</span></div><div><b>UNDERDOG</b><span>Thưởng lựa chọn liều</span></div><div><b>LIVE BOARD</b><span>Xếp hạng trực tiếp</span></div></div>
      </div>
      <div className="hero-visual">
        <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
        <div className="preview-card">
          <div className="preview-top"><span className="live-pill"><i/> LIVE QUESTION</span><span className="preview-v">VMC / 03</span></div>
          <h3>Ai có mạng hạ gục đầu tiên?</h3>
          <div className="preview-option"><span className="option-letter">A</span><span>AD</span><span className="bar"><i style={{width:'61%'}}/></span><b>61%</b></div>
          <div className="preview-option dog"><span className="option-letter">B</span><span>SP</span><span className="bar"><i style={{width:'8%'}}/></span><b>8%</b><em>×2</em></div>
          <div className="preview-option"><span className="option-letter">C</span><span>Mid</span><span className="bar"><i style={{width:'21%'}}/></span><b>21%</b></div>
          <div className="preview-option"><span className="option-letter">D</span><span>Rừng</span><span className="bar"><i style={{width:'7%'}}/></span><b>7%</b></div>
          <div className="preview-bottom"><span><Users size={14}/> 34 người đang chơi</span><span><Sparkles size={14}/> UNDERDOG</span></div>
        </div>
        <div className="floating-score"><Trophy size={17}/><span><small>YOUR RANK</small><b>#02 <em>+200 PTS</em></b></span></div>
      </div>
    </div>
    <div className="feature-grid">
      <Feature icon={<Radio/>} title="Câu hỏi trực tiếp" desc="Admin mở và khóa dự đoán theo diễn biến trận đấu."/>
      <Feature icon={<Sparkles/>} title="Underdog multiplier" desc="Chọn đáp án ít người tin tưởng để có cơ hội nhân điểm."/>
      <Feature icon={<BarChart3/>} title="Bảng xếp hạng realtime" desc="Điểm và thứ hạng cập nhật ngay sau khi chấm câu hỏi."/>
    </div>
    <div className="landing-note"><ShieldCheck size={17}/><span>Điểm số được tính ở máy chủ. Mỗi người chỉ được gửi một dự đoán cho mỗi câu hỏi.</span></div>
  </main>;
}
function Feature({ icon, title, desc }) { return <div className="feature-card"><span className="feature-icon">{icon}</span><h3>{title}</h3><p>{desc}</p></div>; }

function AdminLogin({ onBack, onSuccess }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => { e.preventDefault(); setBusy(true); setError(''); try { const d = await api('/api/admin/login', { method: 'POST', body: { username, password } }); onSuccess(d.token); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <main className="narrow page-width"><button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Trang chủ</button><form className="panel auth-panel" onSubmit={submit}><div className="panel-icon"><ShieldCheck size={24}/></div><div className="eyebrow">ADMIN ACCESS</div><h2>Đăng nhập quản trị</h2><p className="muted-text">Chỉ người tổ chức mới có quyền tạo câu hỏi và công bố kết quả.</p>{error && <div className="inline-error">{error}</div>}<label>Tên đăng nhập<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>Mật khẩu<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label><button className="btn btn-primary btn-full" disabled={busy}>{busy?'Đang xác thực…':'Đăng nhập'} <ArrowLeft className="arrow-right" size={17}/></button><p className="tiny-note">Tài khoản mặc định chỉ dùng cho môi trường phát triển. Hãy đổi mật khẩu trong file .env trước khi public.</p></form></main>;
}

function JoinRoom({ onBack, onSuccess, remembered }) {
  const queryCode = new URLSearchParams(window.location.search).get('join') || '';
  const [code, setCode] = useState(() => queryCode || remembered?.code || '');
  const [nickname, setNickname] = useState(() => remembered?.nickname || '');
  const [recoveryPin, setRecoveryPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    const joinDetails = { code: code.trim().toUpperCase(), nickname: nickname.trim() };
    try {
      const d = await api('/api/rooms/join', { method: 'POST', body: { ...joinDetails, recoveryPin } });
      onSuccess(d.token, d.player, d.state, !!d.resumed, joinDetails);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <main className="narrow page-width join-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Trang chủ</button>
    <form className="panel auth-panel join-panel" onSubmit={submit}>
      <div className="panel-icon"><LogIn size={24}/></div><div className="eyebrow">JOIN LIVE EVENT</div>
      <h2>Vào phòng dự đoán</h2><p className="muted-text">Dùng tên cố định để tích lũy điểm xuyên suốt sự kiện. Nếu đã từng vào phòng, hãy nhập lại đúng tên và mã khôi phục.</p>
      {error && <div className="inline-error">{error}</div>}
      <label>Mã phòng<input value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''))} placeholder="VD: A4F29C" minLength={4} maxLength={8} autoCapitalize="characters" required/></label>
      <label>Tên hiển thị<input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Tên của bạn trong bảng xếp hạng" minLength={2} maxLength={24} autoComplete="nickname" required/></label>
      <label>Mã khôi phục 6 số<input value={recoveryPin} onChange={e=>setRecoveryPin(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="Tạo mã riêng, ví dụ 482915" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="off" required/></label>
      <div className="recovery-note"><ShieldCheck size={17}/><span><b>Đừng quên mã khôi phục này</b><small>Mã giúp bạn vào lại đúng tên và giữ nguyên điểm nếu tắt máy, đổi trình duyệt hoặc đăng xuất. Không dùng ngày sinh hay mã dễ đoán.</small></span></div>
      <button className="btn btn-primary btn-full join-submit" disabled={busy || recoveryPin.length !== 6}>{busy?'Đang xác thực…':'Vào phòng / Khôi phục tài khoản'} <ArrowLeft className="arrow-right" size={17}/></button>
    </form>
  </main>;
}

function AdminApp({ token, rooms, selectedRoom, setSelectedRoom, state, onRefresh, onState, setError, setNotice }) {
  const [roomName, setRoomName] = useState('VMC GRAND FINAL');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState(['AD','SP','Mid','Rừng','Top']);
  const [basePoints, setBasePoints] = useState(100);
  const [underdogEnabled, setUnderdogEnabled] = useState(true);
  const [threshold, setThreshold] = useState(15);
  const [multiplier, setMultiplier] = useState(2);
  const [minVotes, setMinVotes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('questions');

  const room = rooms.find(r => r.id === selectedRoom);
  const createRoom = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const d = await api('/api/admin/rooms', { method: 'POST', token, body: { name: roomName } }); setSelectedRoom(d.room.id); setShowCreate(false); setNotice(`Đã tạo phòng ${d.room.code}`); await onRefresh(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const createQuestion = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await api(`/api/admin/rooms/${selectedRoom}/questions`, { method: 'POST', token, body: { title, options, basePoints, underdogEnabled, underdogThreshold: threshold, underdogMultiplier: multiplier, minVotes } });
      setTitle(''); setShowQuestion(false); setNotice('Đã tạo câu hỏi nháp. Hãy mở câu hỏi khi sẵn sàng.'); await onRefresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const action = async (question, verb, body = {}) => {
    setBusy(true); setError('');
    try {
      const d = await api(`/api/admin/questions/${question.id}/${verb}`, { method: 'POST', token, body });
      setNotice(verb === 'resolve' ? `Đã chấm điểm. ${d.underdogApplied ? `Underdog ×${d.multiplier} được áp dụng.` : 'Không áp dụng hệ số underdog.'}` : ({ open:'Đã mở câu hỏi.', lock:'Đã khóa dự đoán.', cancel:'Đã hủy câu hỏi.' }[verb] || 'Đã cập nhật.'));
      await onRefresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const activeQuestions = (state?.questions || []).filter(q => q.status === 'open');

  return <main className="dashboard page-width">
    <div className="dashboard-head"><div><div className="eyebrow"><span className="pulse-dot"/> ADMIN CONTROL ROOM</div><h1>Điều khiển sự kiện</h1><p>Quản lý phòng, tạo câu hỏi và chốt kết quả theo thời gian thực.</p></div><button className="btn btn-secondary" onClick={onRefresh}><RefreshCw size={16}/> Làm mới</button></div>
    <div className="admin-layout">
      <aside className="sidebar panel">
        <div className="side-title"><span className="feature-icon"><Monitor size={18}/></span><b>Phòng sự kiện</b><button className="icon-button" title="Tạo phòng" onClick={()=>setShowCreate(!showCreate)}><Plus size={17}/></button></div>
        {showCreate && <form className="mini-form" onSubmit={createRoom}><label>Tên phòng<input value={roomName} onChange={e=>setRoomName(e.target.value)} required maxLength={80}/></label><button className="btn btn-primary btn-small btn-full" disabled={busy}>Tạo phòng</button></form>}
        {rooms.length===0 && <div className="empty-small">Chưa có phòng. Tạo phòng đầu tiên để bắt đầu.</div>}
        <div className="room-list">{rooms.map(r=><button key={r.id} className={`room-item ${selectedRoom===r.id?'selected':''}`} onClick={()=>setSelectedRoom(r.id)}><span className="room-led"/><span><b>{r.name}</b><small>MÃ {r.code}</small></span><span className={`status-dot ${r.active?'on':'off'}`}/></button>)}</div>
        {room && <div className="room-share"><span className="muted-text">Mã tham gia</span><strong>{room.code}</strong><button className="btn btn-secondary btn-small btn-full" onClick={()=>{navigator.clipboard?.writeText(room.code);setNotice('Đã sao chép mã phòng.')}}>Sao chép mã phòng</button><a className="share-link" href={`${location.origin}/?join=${room.code}`} onClick={e=>{e.preventDefault();navigator.clipboard?.writeText(`${location.origin}/?join=${room.code}`);setNotice('Đã sao chép link tham gia.')}}>Sao chép link người chơi ↗</a></div>}
      </aside>
      <section className="main-column">
        {!room && <div className="panel empty-state"><Monitor size={34}/><h3>Chưa có phòng sự kiện</h3><p>Tạo phòng đầu tiên ở thanh bên để bắt đầu.</p><button className="btn btn-primary" onClick={()=>setShowCreate(true)}><Plus size={16}/> Tạo phòng</button></div>}
        {room && <>
          <div className="room-overview panel"><div><span className="eyebrow">CURRENT EVENT</span><h2>{room.name}</h2><p>Mã phòng <b className="mono">{room.code}</b> · {state?.leaderboard?.length || 0} người chơi</p></div><div className="overview-icon"><Users size={25}/></div></div>
          <div className="tabbar"><button className={tab==='questions'?'active':''} onClick={()=>setTab('questions')}><CircleHelp size={16}/> Câu hỏi</button><button className={tab==='leaderboard'?'active':''} onClick={()=>setTab('leaderboard')}><Trophy size={16}/> Bảng xếp hạng</button><button className={tab==='screen'?'active':''} onClick={()=>setTab('screen')}><Monitor size={16}/> Màn hình chiếu</button></div>
          {tab==='questions' && <div className="questions-area">
            {activeQuestions.length > 0 && <div className="live-question-banner"><div><span className="live-pill"><i/> {activeQuestions.length} CÂU ĐANG MỞ</span><h3>Đang nhận dự đoán cho {activeQuestions.length} câu hỏi</h3><p>Vào từng thẻ câu hỏi bên dưới để khóa và chấm điểm độc lập.</p></div></div>}
            <div className="section-head"><div><h3>Danh sách câu hỏi</h3><p>Có thể mở nhiều câu cùng lúc; khóa và chấm từng câu riêng biệt.</p></div><button className="btn btn-primary" disabled={!room.active || busy} onClick={()=>setShowQuestion(!showQuestion)}><Plus size={17}/> Tạo câu hỏi</button></div>
            {showQuestion && <form className="panel question-form" onSubmit={createQuestion}>
              <div className="form-head"><div><h3>Tạo câu hỏi mới</h3><p>Soạn câu hỏi nhanh trong lúc xem trận.</p></div><button type="button" className="icon-button" onClick={()=>setShowQuestion(false)}><X size={18}/></button></div>
              <label>Nội dung câu hỏi<textarea value={title} onChange={e=>setTitle(e.target.value)} placeholder="VD: Ai có mạng hạ gục đầu tiên trong ván này?" minLength={5} maxLength={300} required rows={2}/></label>
              <div className="form-label-row"><label>Danh sách đáp án <small>(2–8 đáp án)</small></label><button type="button" className="text-button" disabled={options.length>=8} onClick={()=>setOptions(v=>[...v,''])}><Plus size={14}/> Thêm đáp án</button></div>
              <div className="options-editor">{options.map((o,i)=><div className="option-edit" key={i}><span>{String.fromCharCode(65+i)}</span><input value={o} onChange={e=>setOptions(v=>v.map((x,j)=>i===j?e.target.value:x))} placeholder={`Đáp án ${i+1}`} maxLength={100} required/><button type="button" className="icon-button" disabled={options.length<=2} onClick={()=>setOptions(v=>v.filter((_,j)=>i!==j))}><X size={15}/></button></div>)}</div>
              <div className="settings-grid"><label>Điểm cơ bản<input type="number" value={basePoints} onChange={e=>setBasePoints(e.target.value)} min="1" max="10000" required/></label><label>Ngưỡng underdog (%)<input type="number" value={threshold} onChange={e=>setThreshold(e.target.value)} min="1" max="50" required/></label><label>Hệ số underdog<input type="number" value={multiplier} onChange={e=>setMultiplier(e.target.value)} min="1" max="5" step=".25" required/></label><label>Lượt tối thiểu<input type="number" value={minVotes} onChange={e=>setMinVotes(e.target.value)} min="2" max="1000" required/></label></div>
              <label className="toggle-row"><input type="checkbox" checked={underdogEnabled} onChange={e=>setUnderdogEnabled(e.target.checked)}/><span><b>Bật thưởng underdog</b><small>Áp dụng hệ số nếu đáp án đúng đạt tỷ lệ thấp hơn hoặc bằng ngưỡng.</small></span></label>
              <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={()=>setShowQuestion(false)}>Hủy</button><button className="btn btn-primary" disabled={busy}>{busy?'Đang lưu…':'Lưu câu hỏi nháp'} <Check size={16}/></button></div>
            </form>}
            {!state?.questions?.length && <div className="panel empty-state"><CircleHelp size={30}/><h3>Chưa có câu hỏi nào</h3><p>Tạo câu hỏi đầu tiên, sau đó mở khi mọi người sẵn sàng dự đoán.</p></div>}
            <div className="question-list">{state?.questions?.map(q=><QuestionAdminCard key={q.id} q={q} busy={busy} action={action}/>)}</div>
          </div>}
          {tab==='leaderboard' && <Leaderboard data={state?.leaderboard||[]} admin/>}
          {tab==='screen' && <Projection state={state} room={room}/>}
        </>}
      </section>
    </div>
  </main>;
}

function QuestionAdminCard({ q, busy, action }) {
  const [correct, setCorrect] = useState(q.options[0]?.key || 'A');
  const stats = q.stats || { total:0, counts:{}, percentages:{} };
  return <div className="panel q-card">
    <div className="q-card-head"><div className="q-id">Q</div><div className="q-main"><div className="q-meta"><span className={`status-pill ${statusClass[q.status]}`}>{statusLabel[q.status]}</span><span>{fmtDate(q.createdAt)}</span><span>{stats.total} lượt</span></div><h3>{q.title}</h3></div><span className="points-pill">{q.basePoints} điểm</span></div>
    <div className="answer-stats">{q.options.map(o=>{const count=stats.counts[o.key]||0;const pct=stats.percentages[o.key]||0;return <div className="answer-stat" key={o.key}><div className="answer-stat-head"><span><b>{o.key}</b> {o.text}</span><span>{count} · {pct}%</span></div><div className="bar-track"><i style={{width:`${pct}%`}}/></div></div>})}</div>
    {q.status==='draft' && <div className="q-actions"><button className="btn btn-primary btn-small" disabled={busy} onClick={()=>action(q,'open')}><Radio size={15}/> Mở dự đoán</button><button className="btn btn-ghost btn-small" disabled={busy} onClick={()=>action(q,'cancel')}><X size={15}/> Hủy</button></div>}
    {q.status==='open' && <div className="q-actions"><span className="muted-text"><span className="pulse-dot"/> Đang nhận dự đoán</span><button className="btn btn-danger btn-small" disabled={busy} onClick={()=>action(q,'lock')}><Lock size={15}/> Khóa câu hỏi</button><button className="btn btn-ghost btn-small" disabled={busy} onClick={()=>action(q,'cancel')}><X size={15}/> Hủy</button></div>}
    {q.status==='locked' && <div className="resolve-box"><label>Chọn đáp án đúng<select value={correct} onChange={e=>setCorrect(e.target.value)}>{q.options.map(o=><option value={o.key} key={o.key}>{o.key} — {o.text}</option>)}</select></label><div className="resolve-summary"><span>Tỷ lệ đáp án chọn: {stats.total} lượt</span><span>Underdog khi tỷ lệ ≤ {q.underdogThreshold}% và đủ {q.minVotes} lượt</span></div><button className="btn btn-primary" disabled={busy} onClick={()=>action(q,'resolve',{correctOption:correct})}><Check size={16}/> Xác nhận đáp án & chấm điểm</button></div>}
    {q.status==='resolved' && <div className="resolved-note"><Check size={16}/><span>Đáp án đúng: <b>{q.correctOption} — {q.options.find(o=>o.key===q.correctOption)?.text}</b></span><span className="spacer"/><b>{q.stats.total} dự đoán</b></div>}
    {q.status==='cancelled' && <div className="muted-text">Câu hỏi đã hủy, không tính điểm.</div>}
  </div>;
}

function Leaderboard({ data, admin = false, playerId }) {
  return <div className="panel leaderboard-panel"><div className="section-head"><div><h3><Trophy size={19}/> Bảng xếp hạng</h3><p>Điểm được cập nhật sau mỗi câu hỏi được chấm.</p></div><span className="count-pill"><Users size={14}/> {data.length} người</span></div>
    {!data.length ? <div className="empty-small">Chưa có người chơi hoặc chưa có điểm.</div> : <div className="table-wrap"><table><thead><tr><th>Hạng</th><th>Người chơi</th><th>Điểm</th><th>Câu đúng</th><th>Underdog</th></tr></thead><tbody>{data.map(r=><tr key={r.playerId} className={playerId===r.playerId?'me-row':''}><td><span className={`rank rank-${r.rank<=3?r.rank:'other'}`}>{r.rank<=3?<Crown size={14}/>:r.rank}</span></td><td><b>{r.nickname}</b>{playerId===r.playerId&&<small className="you-tag">BẠN</small>}</td><td className="points-cell">{Number(r.points).toLocaleString('vi-VN')}</td><td>{r.correctCount}</td><td><span className="dog-count"><Sparkles size={13}/>{r.underdogWins}</span></td></tr>)}</tbody></table></div>}
  </div>;
}

function Projection({ state, room }) {
  const openQuestions = (state?.questions || []).filter(x => x.status === 'open');
  const latestQuestion = (state?.questions || []).find(x => x.status === 'locked') || (state?.questions || [])[0];
  const shownQuestions = openQuestions.length ? openQuestions : (latestQuestion ? [latestQuestion] : []);
  return <div className="projection">
    <div className="projection-top"><div className="eyebrow"><span className="pulse-dot"/> LIVE VIEWING PARTY</div><h1>{room?.name}</h1><p>{openQuestions.length ? `${openQuestions.length} câu hỏi đang nhận dự đoán` : 'Dự đoán trực tiếp · Cạnh tranh điểm underdog'}</p></div>
    {shownQuestions.length ? <div className="projection-question-list">{shownQuestions.map(q => <div className="projection-question" key={q.id}><span className={`status-pill ${statusClass[q.status]}`}>{statusLabel[q.status]}</span><h2>{q.title}</h2><div className="projection-options">{q.options.map(o=><div className="projection-option" key={o.key}><span>{o.key}</span><b>{o.text}</b><div className="bar-track"><i style={{width:`${q.stats?.percentages?.[o.key]||0}%`}}/></div><strong>{q.stats?.percentages?.[o.key]||0}%</strong></div>)}</div></div>)}</div> : <div className="projection-question"><h2>Đang chờ câu hỏi tiếp theo…</h2><p>MC sẽ mở dự đoán ngay trong trận đấu.</p></div>}
    <Leaderboard data={state?.leaderboard||[]} admin/>
  </div>;
}

function PlayerApp({ token, info, state, onRefresh, onState, setError, setNotice }) {
  const [submitting, setSubmitting] = useState(false);
  const room = state?.room;
  const activeQuestions = (state?.questions || []).filter(q=>q.status==='open');
  const questions = state?.questions || [];
  const myScore = state?.leaderboard?.find(r=>r.playerId===info?.id);
  const submit = async (q, optionKey) => {
    setSubmitting(true); setError('');
    try { await api(`/api/player/questions/${q.id}/predict`, { method:'POST', token, body:{optionKey} }); setNotice('Đã ghi nhận dự đoán. Bạn không thể thay đổi đáp án này.'); await onRefresh(); }
    catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };
  return <main className="player-page page-width">
    <div className="player-welcome"><div><div className="eyebrow"><span className="pulse-dot"/> ĐANG THAM GIA</div><h1>Chào, {info?.nickname || 'Player'}!</h1><p>{room?.name || 'VMC Live Prediction'} · Mã phòng <b className="mono">{room?.code || '—'}</b></p></div><div className="player-score"><Trophy size={19}/><span><small>TỔNG ĐIỂM</small><b>{Number(myScore?.points||0).toLocaleString('vi-VN')}</b></span></div></div>
    <div className="player-grid"><section className="player-main">
      {activeQuestions.length ? <><div className="active-questions-heading"><div><h2>Câu hỏi đang mở</h2><p>Trả lời từng câu độc lập. Bạn có thể gửi dự đoán cho tất cả câu đang mở.</p></div><span className="count-pill">{activeQuestions.length} câu</span></div><div className="active-player-questions">{activeQuestions.map(q=><PlayerQuestion key={q.id} q={q} submitting={submitting} onSubmit={submit}/>)}</div></> : <div className="panel waiting-card"><div className="waiting-icon"><Radio size={28}/></div><span className="eyebrow">STANDBY</span><h2>Chưa có câu hỏi đang mở</h2><p>Khi MC mở một hoặc nhiều câu hỏi, chúng sẽ xuất hiện tại đây.</p><div className="waiting-animation"><i/><i/><i/></div></div>}
      {questions.filter(q=>q.status!=='draft' && q.status!=='open').length>0 && <div className="panel history-panel"><div className="section-head"><div><h3>Lịch sử câu hỏi</h3><p>Các câu đã khóa, công bố hoặc hủy.</p></div></div>{questions.filter(q=>q.status!=='draft' && q.status!=='open').map(q=><div className="history-item" key={q.id}><div className="history-status">{q.status==='resolved'?<Check size={16}/>:<Lock size={16}/>}</div><div className="history-main"><b>{q.title}</b><small>{q.myOption?`Bạn chọn ${q.myOption} — ${q.options.find(o=>o.key===q.myOption)?.text}`:'Bạn chưa dự đoán câu này'}</small></div><div className="history-points">{q.status==='resolved'?`+${q.myScore?.points||0}`:statusLabel[q.status]}</div></div>)}</div>}
    </section><aside className="player-side"><Leaderboard data={state?.leaderboard||[]} playerId={info?.id}/><div className="panel player-rules"><h3><ShieldCheck size={17}/> Luật tính điểm</h3><ul><li>Chọn một đáp án trước khi câu hỏi khóa.</li><li>Đáp án đúng nhận điểm cơ bản.</li><li>Nếu đáp án đúng ít người chọn và đạt điều kiện, điểm có thể nhân hệ số underdog.</li><li>Không thể đổi đáp án sau khi gửi.</li></ul></div></aside></div>
  </main>;
}
function PlayerQuestion({ q, submitting, onSubmit }) {
  const [selected, setSelected] = useState('');
  const [confirm, setConfirm] = useState(false);
  const submitted = !!q.myOption;
  return <div className="panel live-player-question">
    <div className="question-topline"><span className="live-pill"><i/> CÂU HỎI ĐANG MỞ</span><span className="question-count"><Users size={14}/> {q.stats?.total||0} dự đoán</span></div>
    <div className="question-number">LIVE PREDICTION <span>/{q.id.slice(0,5).toUpperCase()}</span></div><h2>{q.title}</h2>
    <p className="muted-text">Chọn một đáp án. Sau khi xác nhận, bạn sẽ không thể thay đổi.</p>
    <div className="player-options">{q.options.map(o=><button key={o.key} disabled={submitted||submitting} className={`player-option ${selected===o.key?'selected':''} ${submitted&&q.myOption===o.key?'submitted':''}`} onClick={()=>setSelected(o.key)}><span className="option-letter">{o.key}</span><b>{o.text}</b>{selected===o.key&&<Check size={17}/>}</button>)}</div>
    {q.underdogEnabled && <div className="underdog-hint"><Sparkles size={17}/><span><b>Underdog đang bật</b><small>Đáp án đúng có tỷ lệ ≤ {q.underdogThreshold}% và đủ {q.minVotes} lượt có thể nhận ×{q.underdogMultiplier} điểm.</small></span></div>}
    {submitted ? <div className="submitted-banner"><Check size={18}/><span><b>Đã ghi nhận dự đoán</b><small>Bạn chọn {q.myOption} — {q.options.find(o=>o.key===q.myOption)?.text}. Hãy theo dõi kết quả sau khi MC công bố.</small></span></div> : <button className="btn btn-primary btn-full submit-prediction" disabled={!selected||submitting} onClick={()=>setConfirm(true)}>{submitting?'Đang gửi…':'Xác nhận dự đoán'} <Check size={17}/></button>}
    {confirm && <div className="confirm-overlay"><div className="confirm-dialog"><div className="panel-icon"><CircleHelp size={22}/></div><h3>Chốt dự đoán?</h3><p>Bạn chọn <b>{selected} — {q.options.find(o=>o.key===selected)?.text}</b>. Bạn không thể đổi đáp án sau khi gửi.</p><div className="confirm-actions"><button className="btn btn-secondary" onClick={()=>setConfirm(false)}>Xem lại</button><button className="btn btn-primary" onClick={()=>{setConfirm(false);onSubmit(q,selected);}}>Chốt đáp án</button></div></div></div>}
  </div>;
}

export default App;