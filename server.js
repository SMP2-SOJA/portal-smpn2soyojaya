// ================================================================
// SERVER.JS — Portal SMPN 2 Soyo Jaya
// Menghubungkan: Portal + CBT + Absensi ke Supabase masing-masing
// Deploy ke: Vercel
// ================================================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('.'));

// ================================================================
// KONEKSI SUPABASE
// Isi ENV vars ini di Vercel Dashboard → Settings → Environment Variables
// ================================================================
const DB = {
  portal: createClient(
    process.env.PORTAL_SUPABASE_URL || 'https://hohikscwubpgpusmcqhi.supabase.co',
    process.env.PORTAL_SUPABASE_KEY || 'sb_publishable_lNFWSU3cv8agoYZORyVlQQ_QNsLlScI'
  ),
  cbt: createClient(
    process.env.CBT_SUPABASE_URL || 'https://uftiednbhdmexxlabhad.supabase.co',
    process.env.CBT_SUPABASE_KEY || 'sb_publishable_TAEkdHBM3n5nY-I4bm-zaA_C5y9sEwH'
  ),
  absen: createClient(
    process.env.ABSEN_SUPABASE_URL || 'https://jkdvcruwhpdqfsmbguhv.supabase.co',
    process.env.ABSEN_SUPABASE_KEY || 'sb_publishable_DjiBQThdVZBmu_TDXeoTOg_oawlrqgf'
  ),
};

// ================================================================
// HELPER
// ================================================================
const ok  = (res, data) => res.json({ success: true, data });
const err = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

// ================================================================
// AUTH — LOGIN TERPADU
// Cek users di Portal Supabase (tabel users terpadu)
// ================================================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return err(res, 'Username dan password wajib diisi');

  const { data, error } = await DB.portal
    .from('users')
    .select('id, username, name, role, kelas, mapel, kelas_akses, nip, aktif')
    .eq('username', username.toLowerCase().trim())
    .eq('password', password)
    .eq('aktif', true)
    .single();

  if (error || !data) return err(res, 'Username atau password salah', 401);

  // Log aktivitas
  await DB.portal.from('activity_log').insert({
    user_id: data.id,
    username: data.username,
    aksi: 'login',
    detail: `Login berhasil sebagai ${data.role}`,
  });

  ok(res, {
    user: data,
    token: Buffer.from(`${data.id}:${data.role}:${Date.now()}`).toString('base64'),
  });
});

// ================================================================
// USERS — Kelola Pengguna (Admin only)
// ================================================================
app.get('/api/users', async (req, res) => {
  const { role, kelas, search } = req.query;
  let query = DB.portal.from('users').select('id,username,name,role,kelas,mapel,nip,aktif');
  if (role)   query = query.eq('role', role);
  if (kelas)  query = query.eq('kelas', kelas);
  if (search) query = query.or(`username.ilike.%${search}%,name.ilike.%${search}%`);
  const { data, error } = await query.order('role').order('name');
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/users', async (req, res) => {
  const { username, password, name, role, kelas, mapel, nip } = req.body;
  const { data, error } = await DB.portal.from('users').insert({
    username: username.toLowerCase().trim(),
    password, name, role, kelas, mapel, nip
  }).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

app.patch('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  delete updates.id;
  updates.updated_at = new Date().toISOString();
  const { data, error } = await DB.portal.from('users').update(updates).eq('id', id).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password || password.length < 6) return err(res, 'Password minimal 6 karakter');
  const { error } = await DB.portal.from('users').update({ password, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return err(res, error.message);
  ok(res, { message: 'Password berhasil direset' });
});

// ================================================================
// SISWA
// ================================================================
app.get('/api/siswa', async (req, res) => {
  const { kelas, search } = req.query;
  let query = DB.portal.from('siswa').select('*').eq('aktif', true);
  if (kelas)  query = query.eq('kelas', kelas);
  if (search) query = query.or(`nama_siswa.ilike.%${search}%,id_siswa.ilike.%${search}%`);
  const { data, error } = await query.order('nama_siswa');
  if (error) return err(res, error.message);
  ok(res, data);
});

// ================================================================
// ABSENSI SISWA
// ================================================================
app.get('/api/absensi', async (req, res) => {
  const { kelas, tanggal, id_siswa } = req.query;
  let query = DB.portal.from('absensi_siswa')
    .select('*, siswa(nama_siswa, kelas)');
  if (id_siswa) query = query.eq('id_siswa', id_siswa);
  if (tanggal)  query = query.gte('waktu_scan', tanggal + 'T00:00:00').lte('waktu_scan', tanggal + 'T23:59:59');
  const { data, error } = await query.order('waktu_scan', { ascending: false });
  if (error) return err(res, error.message);
  // Filter kelas via join
  const filtered = kelas ? data.filter(d => d.siswa?.kelas === kelas) : data;
  ok(res, filtered);
});

app.post('/api/absensi', async (req, res) => {
  const { id_siswa, jenis_absen, status, keterangan, id_jadwal } = req.body;
  const { data, error } = await DB.portal.from('absensi_siswa').insert({
    id_siswa, jenis_absen, status: status || 'hadir', keterangan, id_jadwal
  }).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// Rekap absensi per siswa
app.get('/api/absensi/rekap/:id_siswa', async (req, res) => {
  const { id_siswa } = req.params;
  const { bulan, tahun } = req.query;
  const start = `${tahun || new Date().getFullYear()}-${String(bulan || new Date().getMonth()+1).padStart(2,'0')}-01`;
  const end   = new Date(new Date(start).getFullYear(), new Date(start).getMonth()+1, 0).toISOString().split('T')[0];
  const { data, error } = await DB.portal.from('absensi_siswa')
    .select('*')
    .eq('id_siswa', id_siswa)
    .gte('waktu_scan', start).lte('waktu_scan', end + 'T23:59:59')
    .order('waktu_scan');
  if (error) return err(res, error.message);
  const rekap = {
    hadir: data.filter(d => d.status === 'hadir').length,
    izin:  data.filter(d => d.status === 'izin').length,
    sakit: data.filter(d => d.status === 'sakit').length,
    alpha: data.filter(d => d.status === 'alpha').length,
    detail: data,
  };
  rekap.total = rekap.hadir + rekap.izin + rekap.sakit + rekap.alpha;
  rekap.persen = rekap.total ? Math.round((rekap.hadir / rekap.total) * 100) : 0;
  ok(res, rekap);
});

// Absensi guru
app.get('/api/absensi-guru', async (req, res) => {
  const { tanggal } = req.query;
  let query = DB.portal.from('absensi_guru').select('*');
  if (tanggal) query = query.eq('tanggal', tanggal);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/absensi-guru', async (req, res) => {
  const { nip, nama_guru, user_id, tanggal, waktu_masuk, waktu_pulang, status, alasan, file_url } = req.body;
  const { data, error } = await DB.portal.from('absensi_guru').insert({
    nip, nama_guru, user_id, tanggal: tanggal || new Date().toISOString().split('T')[0],
    waktu_masuk, waktu_pulang, status: status || 'hadir', alasan, file_url
  }).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// ================================================================
// JADWAL PELAJARAN
// ================================================================
app.get('/api/jadwal', async (req, res) => {
  const { kelas, guru_id, hari } = req.query;
  let query = DB.portal.from('jadwal_pelajaran').select('*').eq('aktif', true);
  if (kelas)   query = query.eq('kelas', kelas);
  if (guru_id) query = query.eq('guru_id', guru_id);
  if (hari)    query = query.eq('hari', hari);
  const { data, error } = await query.order('hari').order('jam_ke');
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/jadwal', async (req, res) => {
  const { data, error } = await DB.portal.from('jadwal_pelajaran').insert(req.body).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

app.delete('/api/jadwal/:id', async (req, res) => {
  const { error } = await DB.portal.from('jadwal_pelajaran').update({ aktif: false }).eq('id', req.params.id);
  if (error) return err(res, error.message);
  ok(res, { message: 'Jadwal dihapus' });
});

// Deteksi konflik jadwal
app.get('/api/jadwal/konflik', async (req, res) => {
  const { data, error } = await DB.portal.from('jadwal_pelajaran')
    .select('*').eq('aktif', true).order('hari').order('jam_ke');
  if (error) return err(res, error.message);

  const konflik = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i], b = data[j];
      if (a.hari === b.hari && a.jam_ke === b.jam_ke) {
        if (a.guru_id && a.guru_id === b.guru_id)
          konflik.push({ tipe: 'guru', pesan: `${a.nama_guru} mengajar 2 kelas di ${a.hari} jam ke-${a.jam_ke}`, a, b });
        if (a.kelas === b.kelas)
          konflik.push({ tipe: 'kelas', pesan: `Kelas ${a.kelas} punya 2 mapel di ${a.hari} jam ke-${a.jam_ke}`, a, b });
      }
    }
  }
  ok(res, { total: konflik.length, konflik });
});

// ================================================================
// NILAI SISWA
// ================================================================
app.get('/api/nilai', async (req, res) => {
  const { id_siswa, kelas, nama_mapel, semester } = req.query;
  let query = DB.portal.from('nilai_siswa').select('*, siswa(nama_siswa)');
  if (id_siswa)  query = query.eq('id_siswa', id_siswa);
  if (kelas)     query = query.eq('kelas', kelas);
  if (nama_mapel) query = query.eq('nama_mapel', nama_mapel);
  if (semester)  query = query.eq('semester', semester);
  const { data, error } = await query;
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/nilai', async (req, res) => {
  const { data, error } = await DB.portal.from('nilai_siswa')
    .upsert(req.body, { onConflict: 'id_siswa,nama_mapel,kelas,semester,tahun_pelajaran' })
    .select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// ================================================================
// LMS — TUGAS
// ================================================================
app.get('/api/lms/tugas', async (req, res) => {
  const { kelas, guru_id, status } = req.query;
  let query = DB.portal.from('lms_tugas').select('*');
  if (kelas)   query = query.ilike('kelas', `%${kelas}%`);
  if (guru_id) query = query.eq('guru_id', guru_id);
  if (status)  query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/lms/tugas', async (req, res) => {
  const { data, error } = await DB.portal.from('lms_tugas').insert(req.body).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// Pengumpulan tugas oleh siswa
app.get('/api/lms/pengumpulan', async (req, res) => {
  const { tugas_id, id_siswa } = req.query;
  let query = DB.portal.from('lms_pengumpulan').select('*');
  if (tugas_id) query = query.eq('tugas_id', tugas_id);
  if (id_siswa) query = query.eq('id_siswa', id_siswa);
  const { data, error } = await query.order('waktu_kumpul', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/lms/pengumpulan', async (req, res) => {
  // Cek apakah sudah lewat tenggat
  const { tugas_id, id_siswa, tipe_file, file_url, link_url, nama_siswa, kelas } = req.body;
  const { data: tugas } = await DB.portal.from('lms_tugas').select('tenggat, mode_koreksi, kunci_jawaban').eq('id', tugas_id).single();
  const terlambat = tugas?.tenggat ? new Date() > new Date(tugas.tenggat) : false;

  const { data, error } = await DB.portal.from('lms_pengumpulan').insert({
    tugas_id, id_siswa, nama_siswa, kelas, tipe_file, file_url, link_url, terlambat
  }).select().single();
  if (error) return err(res, error.message);
  ok(res, { ...data, terlambat });
});

// Koreksi / beri nilai
app.patch('/api/lms/pengumpulan/:id/nilai', async (req, res) => {
  const { nilai_final, catatan_guru } = req.body;
  const { data, error } = await DB.portal.from('lms_pengumpulan')
    .update({ nilai_final, catatan_guru, status: 'dinilai' })
    .eq('id', req.params.id).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// Materi LMS
app.get('/api/lms/materi', async (req, res) => {
  const { kelas, mapel, guru_id } = req.query;
  let query = DB.portal.from('lms_materi').select('*').eq('aktif', true);
  if (kelas)   query = query.ilike('kelas', `%${kelas}%`);
  if (mapel)   query = query.eq('mapel', mapel);
  if (guru_id) query = query.eq('guru_id', guru_id);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/lms/materi', async (req, res) => {
  const { data, error } = await DB.portal.from('lms_materi').insert(req.body).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// ================================================================
// PUSTAKA
// ================================================================
app.get('/api/pustaka/buku', async (req, res) => {
  const { kategori, search, tipe } = req.query;
  let query = DB.portal.from('pustaka_buku').select('*');
  if (kategori) query = query.eq('kategori', kategori);
  if (tipe === 'digital') query = query.eq('ada_digital', true);
  if (tipe === 'fisik')   query = query.eq('ada_fisik', true);
  if (search)   query = query.or(`judul.ilike.%${search}%,pengarang.ilike.%${search}%`);
  const { data, error } = await query.order('judul');
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/pustaka/buku', async (req, res) => {
  const { data, error } = await DB.portal.from('pustaka_buku').insert(req.body).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

// Pinjam buku fisik
app.get('/api/pustaka/pinjaman', async (req, res) => {
  const { status, id_siswa, peminjam_id } = req.query;
  let query = DB.portal.from('pustaka_pinjaman')
    .select('*, pustaka_buku(judul, pengarang)');
  if (status)      query = query.eq('status', status);
  if (id_siswa)    query = query.eq('id_siswa', id_siswa);
  if (peminjam_id) query = query.eq('peminjam_id', peminjam_id);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/pustaka/pinjaman', async (req, res) => {
  const { buku_id, peminjam_id, id_siswa, nama_peminjam, kelas, disetujui_oleh } = req.body;

  // Cek stok
  const { data: buku } = await DB.portal.from('pustaka_buku').select('stok_tersedia, judul').eq('id', buku_id).single();
  if (!buku || buku.stok_tersedia < 1) return err(res, 'Stok buku tidak tersedia');

  // Buat pinjaman, batas 7 hari
  const tgl_batas = new Date();
  tgl_batas.setDate(tgl_batas.getDate() + 7);

  const { data, error } = await DB.portal.from('pustaka_pinjaman').insert({
    buku_id, peminjam_id, id_siswa, nama_peminjam, kelas, disetujui_oleh,
    tgl_batas: tgl_batas.toISOString().split('T')[0],
  }).select().single();
  if (error) return err(res, error.message);

  // Kurangi stok
  await DB.portal.from('pustaka_buku').update({ stok_tersedia: buku.stok_tersedia - 1 }).eq('id', buku_id);

  ok(res, data);
});

// Kembalikan buku
app.patch('/api/pustaka/pinjaman/:id/kembali', async (req, res) => {
  const { id } = req.params;
  const { data: pinjaman } = await DB.portal.from('pustaka_pinjaman').select('buku_id, tgl_batas').eq('id', id).single();

  const tgl_kembali = new Date().toISOString().split('T')[0];
  const terlambat   = new Date() > new Date(pinjaman.tgl_batas);
  const hari_telat  = terlambat ? Math.floor((new Date() - new Date(pinjaman.tgl_batas)) / 86400000) : 0;
  const denda       = hari_telat * 1000; // Rp 1.000/hari

  const { data, error } = await DB.portal.from('pustaka_pinjaman')
    .update({ tgl_kembali, status: 'dikembalikan', denda }).eq('id', id).select().single();
  if (error) return err(res, error.message);

  // Kembalikan stok
  const { data: buku } = await DB.portal.from('pustaka_buku').select('stok_tersedia').eq('id', pinjaman.buku_id).single();
  await DB.portal.from('pustaka_buku').update({ stok_tersedia: buku.stok_tersedia + 1 }).eq('id', pinjaman.buku_id);

  ok(res, { ...data, hari_telat, denda });
});

// ================================================================
// NOTIFIKASI
// ================================================================
app.get('/api/notifikasi', async (req, res) => {
  const { user_id, role_target, kelas_target } = req.query;
  let query = DB.portal.from('notifikasi').select('*');
  if (user_id)      query = query.or(`user_id.eq.${user_id},user_id.is.null`);
  if (role_target)  query = query.or(`role_target.eq.${role_target},role_target.is.null`);
  if (kelas_target) query = query.or(`kelas_target.eq.${kelas_target},kelas_target.is.null`);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
  if (error) return err(res, error.message);
  ok(res, data);
});

app.post('/api/notifikasi', async (req, res) => {
  const { data, error } = await DB.portal.from('notifikasi').insert(req.body).select().single();
  if (error) return err(res, error.message);
  ok(res, data);
});

app.patch('/api/notifikasi/:id/baca', async (req, res) => {
  const { error } = await DB.portal.from('notifikasi').update({ dibaca: true }).eq('id', req.params.id);
  if (error) return err(res, error.message);
  ok(res, { message: 'Ditandai sudah dibaca' });
});

// ================================================================
// CBT — Proxy ke Supabase CBT lama (data historis)
// Atau bisa langsung dari tabel cbt_* di portal baru
// ================================================================
app.get('/api/cbt/schedules', async (req, res) => {
  const { kelas, status } = req.query;
  let query = DB.portal.from('cbt_schedules').select('*');
  if (kelas)  query = query.ilike('kelas', `%${kelas}%`);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('tanggal', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

app.get('/api/cbt/results', async (req, res) => {
  const { kelas, mapel, id_siswa } = req.query;
  let query = DB.portal.from('cbt_results').select('*');
  if (kelas)    query = query.eq('kelas', kelas);
  if (mapel)    query = query.eq('mapel', mapel);
  if (id_siswa) query = query.eq('id_siswa', id_siswa);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return err(res, error.message);
  ok(res, data);
});

// Live score (publik, tanpa auth)
app.get('/api/cbt/livescore', async (req, res) => {
  const { data, error } = await DB.portal.from('cbt_results')
    .select('student_name, mapel, nilai, kelas, tanggal')
    .order('nilai', { ascending: false })
    .limit(100);
  if (error) return err(res, error.message);
  ok(res, data);
});

// ================================================================
// LOG AKTIVITAS
// ================================================================
app.get('/api/log', async (req, res) => {
  const { limit = 100 } = req.query;
  const { data, error } = await DB.portal.from('activity_log')
    .select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
  if (error) return err(res, error.message);
  ok(res, data);
});

// ================================================================
// STATISTIK DASHBOARD
// ================================================================
app.get('/api/stats', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const [users, siswa, hadir_hari_ini, pinjaman_aktif, terlambat] = await Promise.all([
    DB.portal.from('users').select('id', { count: 'exact', head: true }),
    DB.portal.from('siswa').select('id_siswa', { count: 'exact', head: true }).eq('aktif', true),
    DB.portal.from('absensi_siswa').select('id_absen', { count: 'exact', head: true })
      .eq('status', 'hadir').gte('waktu_scan', today + 'T00:00:00'),
    DB.portal.from('pustaka_pinjaman').select('id', { count: 'exact', head: true }).eq('status', 'dipinjam'),
    DB.portal.from('pustaka_pinjaman').select('id', { count: 'exact', head: true })
      .eq('status', 'dipinjam').lt('tgl_batas', today),
  ]);

  ok(res, {
    total_users:       users.count || 0,
    total_siswa:       siswa.count || 0,
    hadir_hari_ini:    hadir_hari_ini.count || 0,
    pinjaman_aktif:    pinjaman_aktif.count || 0,
    pinjaman_terlambat: terlambat.count || 0,
  });
});

// ================================================================
// SERVE PORTAL HTML
// ================================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal-sekolah.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal-sekolah.html'));
});

// ================================================================
// START SERVER
// ================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Portal SMPN 2 Soyo Jaya running on port ${PORT}`));

module.exports = app;
