
const NOTIFY_KEY='workPlaceNotifications';
function localNotifications(){try{const a=JSON.parse(localStorage.getItem(NOTIFY_KEY)||'[]');return Array.isArray(a)?a:[]}catch{return []}}
function saveLocalNotifications(a){localStorage.setItem(NOTIFY_KEY,JSON.stringify(a.slice(0,50)))}
function addLocalNotification(n){const a=localNotifications();a.unshift({id:'local-'+Date.now(),type:n.type||'system',title:n.title||'Notification',message:n.message||'',link:n.link||'',read_at:null,created_at:new Date().toISOString()});saveLocalNotifications(a);renderNotificationBell()}
function currentUserId(){const u=getUser();return Number(u?.id)||null}
async function fetchNotifications(){const u=getUser();if(!u)return localNotifications();try{const r=await fetch('/api/notifications?userId='+encodeURIComponent(u.id));const d=await r.json();if(r.ok&&d.ok){const local=localNotifications();return [...(d.notifications||[]),...local].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,50)}}catch(e){}return localNotifications()}
async function markNotificationRead(id){const u=getUser();if(String(id).startsWith('local-')){const a=localNotifications().map(n=>n.id===id?{...n,read_at:new Date().toISOString()}:n);saveLocalNotifications(a);return}if(!u)return;try{await fetch('/api/notifications/'+encodeURIComponent(id)+'/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id})})}catch(e){}}
async function markAllNotificationsRead(){const u=getUser();if(u){try{await fetch('/api/notifications/read-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id})})}catch(e){}}saveLocalNotifications(localNotifications().map(n=>({...n,read_at:new Date().toISOString()})));renderNotificationBell()}
function renderNotificationBell(){const wrap=document.querySelector('.notification-wrap');if(!wrap)return;const list=wrap.querySelector('.notification-list');const count=wrap.querySelector('.notification-count');if(!list||!count)return;fetchNotifications().then(rows=>{const unread=rows.filter(n=>!n.read_at).length;count.textContent=unread>99?'99+':String(unread);count.style.display=unread?'flex':'none';list.innerHTML=rows.length?rows.map(n=>`<button class="notification-item ${n.read_at?'read':''}" onclick="openNotification('${String(n.id).replace(/'/g,"&#039;")}','${String(n.link||'').replace(/'/g,"&#039;")}')"><b>${escapeHtml(n.title)}</b><span>${escapeHtml(n.message)}</span><small>${new Date(n.created_at).toLocaleString()}</small></button>`).join(''):'<div class="notification-empty">No notifications</div>'})}
async function openNotification(id,link){await markNotificationRead(id);renderNotificationBell();if(link)location.href=link}
function toggleNotificationPanel(){const wrap=document.querySelector('.notification-wrap');if(!wrap)return;wrap.classList.toggle('open');if(wrap.classList.contains('open'))renderNotificationBell()}
function initNotifications(){const wrap=document.querySelector('.notification-wrap');if(!wrap)return;wrap.querySelector('.notification-button')?.addEventListener('click',e=>{e.preventDefault();toggleNotificationPanel()});document.addEventListener('click',e=>{if(!wrap.contains(e.target))wrap.classList.remove('open')});renderNotificationBell();setInterval(renderNotificationBell,20000)}

const KEY="workPlaceJobs";
const USER_KEY="workPlaceUser";
const APPEAL_KEY="workPlaceAppeals";

function getJobs(){return JSON.parse(localStorage.getItem(KEY)||"[]")}
function saveJobs(jobs){localStorage.setItem(KEY,JSON.stringify(jobs))}
function getUser(){return JSON.parse(localStorage.getItem(USER_KEY)||"null")}
function setUser(user){localStorage.setItem(USER_KEY,JSON.stringify(user))}
function getAppeals(){return JSON.parse(localStorage.getItem(APPEAL_KEY)||"[]")}
function saveAppeals(a){localStorage.setItem(APPEAL_KEY,JSON.stringify(a))}

function updateUserUI(){
  const u=getUser();
  document.querySelectorAll(".user-name").forEach(el=>el.textContent=u?u.name:"User");
  document.querySelectorAll(".login-link").forEach(el=>{
    if(u){el.textContent="Logout";el.href="#";el.onclick=()=>{localStorage.removeItem(USER_KEY);location.href="index.html"}}
  });
}

function requireLogin(){
  if(!getUser()){alert("Please Login / Sign Up first.");location.href="login.html";return false}
  return true;
}

async function postJob(e){
  e.preventDefault();
  if(!requireLogin()) return;
  const form=e.target;
  const mediaFiles=[...((form.photos&&form.photos.files)||[])];const videoFile=form.video&&form.video.files&&form.video.files[0];
  const maxPhoto=5*1024*1024,maxVideo=25*1024*1024;
  if(mediaFiles.length>5||mediaFiles.some(f=>f.size>maxPhoto)){alert('Maximum 5 photos, 5 MB each.');return}
  if(videoFile&&videoFile.size>maxVideo){alert('Video must be 25 MB or smaller.');return}
  const job={
    id:Date.now(),
    title:form.title.value.trim(),
    category:form.category.value,
    description:form.description.value.trim(),
    price:Number(form.price.value),
    location:form.location.value.trim(),
    deadline:form.deadline.value,
    postedBy:getUser().name,
    posterId:getUser().id,
    posterProfileId:getUser().profileId||'',
    status:"Pending", acceptedBy:null, acceptedAt:null,
    media:{photos:mediaFiles.map(f=>({name:f.name,size:f.size,type:f.type})),video:videoFile?{name:videoFile.name,size:videoFile.size,type:videoFile.type}:null}
  };
  if(!job.title||!job.category||!job.description||!job.price||!job.location||!job.deadline){
    alert("Please fill in all fields.");return;
  }
  try{
    const r=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({posterId:job.posterId,title:job.title,category:job.category,description:job.description,price:job.price,location:job.location,deadline:job.deadline})});
    const d=await r.json();
    if(!r.ok||!d.ok) throw new Error(d.message||'Could not save the job to the server.');
    job.serverId=d.jobId;
  }catch(err){
    console.warn('Server job save failed; keeping local prototype copy.',err);
  }
  const jobs=getJobs(); jobs.unshift(job); saveJobs(jobs);
  alert("Job posted successfully!");
  form.reset();
  document.getElementById("jobForm")?.classList.add("hidden");
  renderMyStats();
}

function renderMyStats(){
  const box=document.getElementById("myStats"); if(!box)return;
  const u=getUser(); const jobs=getJobs();
  const mine=u?jobs.filter(j=>j.postedBy===u.name):[];
  box.innerHTML=`<div class="stat pending"><span>Pending Jobs</span><b>${mine.filter(j=>j.status==="Pending").length}</b></div>
  <div class="stat completed"><span>Completed Jobs</span><b>${mine.filter(j=>j.status==="Completed").length}</b></div>
  <div class="stat uncompleted"><span>Uncompleted Jobs</span><b>${mine.filter(j=>j.status==="Uncompleted").length}</b></div>`;
}

function showPostForm(){
  if(!requireLogin()) return;
  const f=document.getElementById("jobForm"); if(f){f.classList.remove("hidden");f.scrollIntoView({behavior:"smooth"})}
}

function closePostForm(){document.getElementById("jobForm")?.classList.add("hidden")}

function seedDemoJobs(){
  if(getJobs().length)return;
  saveJobs([
    {id:1,title:"House Cleaning",category:"Cleaning",description:"Need a cleaner for a 2-bedroom home.",price:"1500",location:"Rajshahi",deadline:"2026-09-15",postedBy:"Rahim",status:"Pending"},
    {id:2,title:"Online Data Entry",category:"Virtual / Online",description:"Simple data entry work from home.",price:"2500",location:"Online",deadline:"2026-09-18",postedBy:"Karim",status:"Pending"},
    {id:3,title:"Electric Wiring",category:"Electrician",description:"Small house wiring repair.",price:"2000",location:"Dhaka",deadline:"2026-09-13",postedBy:"Hasan",status:"Pending"},
    {id:4,title:"Food Delivery",category:"Delivery",description:"Deliver food within the local area.",price:"800",location:"Chattogram",deadline:"2026-09-12",postedBy:"Sakib",status:"Pending"},
    {id:5,title:"Garden Cleaning",category:"Gardening",description:"Clean and organize a small garden.",price:"1200",location:"Rajshahi",deadline:"2026-09-20",postedBy:"Nayeem",status:"Pending"}
  ]);
}

function getActorId(){
  const u=getUser();
  return Number(u?.id)||null;
}

async function syncServerJobs(){
  try{
    const r=await fetch('/api/jobs'); const d=await r.json();
    if(!r.ok||!d.ok) throw new Error(d.message||'Job sync failed');
    const serverJobs=(d.jobs||[]).map(j=>({
      id:Number(j.id),serverId:Number(j.id),title:j.title,category:j.category,description:j.description,
      price:j.price,location:j.location,deadline:j.deadline,postedBy:j.poster_name||'Job Poster',
      posterId:j.poster_id,posterProfileId:j.poster_profile_id,posterPhoto:j.poster_photo||'',
      status:j.status,acceptedWorkerId:j.accepted_worker_id||null,
      acceptedBy:j.worker_name||null,acceptedWorkerProfileId:j.worker_profile_id||null,
      adminHold:j.admin_hold||0
    }));
    if(serverJobs.length){
      const local=getJobs();
      const merged=serverJobs.map(j=>{const l=local.find(x=>Number(x.serverId||x.id)===Number(j.id));return l?{...l,...j}:j});
      saveJobs(merged);
    }
  }catch(e){console.warn('Server job sync unavailable; using local prototype jobs.',e)}
}

function renderJobs(){
  const list=document.getElementById("jobList"); if(!list)return;
  const q=(document.getElementById("search")?.value||"").toLowerCase();
  const cat=document.getElementById("categoryFilter")?.value||"";
  const loc=(document.getElementById("locationFilter")?.value||"").toLowerCase();
  const jobs=getJobs().filter(j=>{
    const hay=[j.title,j.description,j.category,j.location,j.postedBy,j.posterProfileId].join(' ').toLowerCase();
    const isAvailable=String(j.status)==='Posted' || String(j.status)==='Pending';
    return isAvailable && hay.includes(q)&&(!cat||j.category===cat)&&(!loc||String(j.location||'').toLowerCase().includes(loc));
  });
  if(!jobs.length){list.innerHTML='<div class="empty">No available jobs found.</div>';return}
  list.innerHTML=jobs.map(j=>`<div class="job clickable-job" role="button" tabindex="0" onclick="openPublicProfileById('${escapeHtml(String(j.posterProfileId||''))}','${escapeHtml(String(j.postedBy||''))}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPublicProfileById('${escapeHtml(String(j.posterProfileId||''))}','${escapeHtml(String(j.postedBy||''))}') }" title="View client profile">
    <div class="job-card-head"><div><h3>${escapeHtml(j.title)}</h3><div class="muted">Client: ${escapeHtml(j.postedBy||'Job Poster')}${j.posterProfileId?` · ID: ${escapeHtml(j.posterProfileId)}`:''}</div></div><span class="status-pill available">Available</span></div>
    <div class="tags"><span class="tag">${escapeHtml(j.category)}</span><span class="tag">${escapeHtml(j.location)}</span></div>
    <p>${escapeHtml(j.description)}</p><div class="price">৳${escapeHtml(j.price)}</div>
    <p class="muted">Deadline: ${escapeHtml(j.deadline)}</p>
    ${j.media?.photos?.length?`<div class="media-preview"><span class="media-chip">📷 ${j.media.photos.length} photo(s)</span>${j.media.video?`<span class="media-chip">🎥 ${escapeHtml(j.media.video.name)}</span>`:''}</div>`:''}
    <button class="btn btn-purple" onclick="event.stopPropagation();takeJob(${Number(j.id)})">Accept Job →</button>
  </div>`).join("");
}

async function takeJob(id){
  if(!requireLogin())return;
  const u=getUser();
  if(String(u.type||'').toLowerCase()!=='worker'){alert('Only a Worker account can accept a job.');return}
  const jobs=getJobs(); const j=jobs.find(x=>Number(x.id)===Number(id)); if(!j)return;
  if(!['Pending','Posted'].includes(String(j.status))){alert('This job is no longer available.');return}
  if(new Date(j.deadline).getTime()<Date.now()){j.status='Expired';saveJobs(jobs);renderJobs();alert('This job deadline has already expired.');return}
  try{
    const r=await fetch('/api/jobs/'+encodeURIComponent(id)+'/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workerId:getActorId()})});
    const d=await r.json();
    if(!r.ok||!d.ok) throw new Error(d.message||'Could not accept job');
    j.status='Pending Client Confirmation';j.acceptedBy=u.name;j.acceptedWorkerId=u.id;j.acceptedWorkerProfileId=u.profileId;j.acceptedAt=new Date().toISOString();saveJobs(jobs);renderJobs();renderNotificationBell();
    alert('Job accepted. The client must review your profile and confirm you.');
  }catch(e){
    console.warn(e);
    // Local fallback keeps the prototype usable when the backend is unavailable.
    j.status='Pending Client Confirmation';j.acceptedBy=u.name;j.acceptedWorkerId=u.id;j.acceptedWorkerProfileId=u.profileId;j.acceptedAt=new Date().toISOString();saveJobs(jobs);renderJobs();
    alert('Job accepted locally. Client confirmation is pending.');
  }
}

function renderWorkers(){
  const list=document.getElementById("workerList");if(!list)return;
  const q=(document.getElementById("workerSearch")?.value||"").toLowerCase();
  const workers=[
    ["Abdul Karim","Electrician","4.9","Rajshahi",25],
    ["Rahim Ahmed","Cleaning","4.7","Dhaka",18],
    ["Sakib Hasan","Delivery","4.8","Chattogram",31],
    ["Nayeem Islam","Gardening","4.6","Rajshahi",14],
    ["Jahid Hasan","Photography","4.9","Dhaka",22],
    ["Karim Mia","Plumbing","4.5","Narayanganj",12]
  ].filter(w=>w.join(" ").toLowerCase().includes(q));
  list.innerHTML=workers.length?workers.map(w=>`<div class="worker clickable-worker" role="button" tabindex="0" onclick="openPublicProfileByName('${escapeHtml(w[0])}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPublicProfileByName('${escapeHtml(w[0])}') }" title="View ${escapeHtml(w[0])} profile"><div class="icon orange">👷</div><h3>${escapeHtml(w[0])}</h3><p><b>${escapeHtml(w[1])}</b></p><p>⭐ ${escapeHtml(w[2])} · ${escapeHtml(w[4])} jobs</p><p class="muted">${escapeHtml(w[3])}</p><button class="btn btn-orange" onclick="event.stopPropagation();contactWorker('${escapeHtml(w[0])}')">Contact Worker</button></div>`).join(""):'<div class="empty">No worker found.</div>';
}

function openPublicProfileById(profileId,name){
  if(profileId){location.href='public-profile.html?profileId='+encodeURIComponent(profileId);return}
  openPublicProfileByName(name||'');
}
function openPublicProfileByName(name){
  if(!name)return;
  location.href='public-profile.html?name='+encodeURIComponent(name);
}
function contactWorker(name){
  if(!requireLogin())return;
  location.href='messaging.html?search='+encodeURIComponent(name);
}

function addAppeal(e){
  e.preventDefault();if(!requireLogin())return;
  const f=e.target;const photos=[...((f.photos&&f.photos.files)||[])];const video=f.video&&f.video.files&&f.video.files[0];if(photos.length>5||photos.some(x=>x.size>5*1024*1024)){alert('Appeal photo limit: 5 files, 5 MB each.');return}if(video&&video.size>25*1024*1024){alert('Appeal video must be 25 MB or smaller.');return}const a=getAppeals();a.unshift({id:Date.now(),job:f.job.value.trim(),reason:f.reason.value.trim(),status:"Under Review",date:new Date().toLocaleDateString(),evidence:{photos:photos.map(x=>x.name),video:video?video.name:null}});saveAppeals(a);f.reset();renderAppeals();alert("Appeal submitted successfully.");
}
function renderAppeals(){
  const box=document.getElementById("appealList");if(!box)return;
  const a=getAppeals();box.innerHTML=a.length?a.map(x=>`<div class="job"><h3>${escapeHtml(x.job)}</h3><p>${escapeHtml(x.reason)}</p><div class="tags"><span class="tag">${x.status}</span><span class="tag">${x.date}</span>${x.evidence?.photos?.length?`<span class="tag">📷 ${x.evidence.photos.length}</span>`:''}${x.evidence?.video?`<span class="tag">🎥 Evidence</span>`:''}</div></div>`).join(""):'<div class="empty">No appeal history yet.</div>';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

document.addEventListener("DOMContentLoaded",async()=>{updateUserUI();initNotifications();seedDemoJobs();renderJobs();renderWorkers();renderAppeals();renderMyStats();await syncServerJobs();renderJobs();renderMyStats()});

const COIN_BALANCE_KEY="workPlaceCoinBalance";const COIN_CHECKIN_KEY="workPlaceDailyCheckin";const COIN_STREAK_KEY="workPlaceDailyStreak";
function getCoins(){return Number(localStorage.getItem(COIN_BALANCE_KEY)||0)}
function setCoins(n){localStorage.setItem(COIN_BALANCE_KEY,String(Math.max(0,Math.floor(Number(n)||0))));document.querySelectorAll(".coin-balance").forEach(el=>el.textContent=getCoins().toLocaleString()+" Coins")}
function addCoins(n){setCoins(getCoins()+Number(n||0))}
function getCoinSettings(){try{return JSON.parse(localStorage.getItem("workPlaceCoinSettings")||"{}")}catch{return {}}}
function getSchedule(){const s=getCoinSettings();let a=Array.isArray(s.dailySchedule)?s.dailySchedule:[];if(a.length<30)a=Array.from({length:30},(_,i)=>Number(a[i]??(i===0?5:0)));a=a.slice(0,30);return a.map(x=>Math.max(0,Number(x)||0))}
async function syncDailyRewardSettings(){try{const r=await fetch('/api/admin/coin-daily-rewards');const d=await r.json();if(d.ok&&Array.isArray(d.values)&&d.values.length===30){const s=getCoinSettings();s.dailySchedule=d.values;localStorage.setItem('workPlaceCoinSettings',JSON.stringify(s));renderCoinWidgets()}}catch(e){}}
function getConversionRate(){const s=getCoinSettings();return Math.max(1,Number(s.coinsPerBDT??100))}
function claimDailyCoins(){const today=new Date().toISOString().slice(0,10);if(localStorage.getItem(COIN_CHECKIN_KEY)===today){alert("Today's daily sign-in reward has already been claimed.");return false}const last=localStorage.getItem(COIN_CHECKIN_KEY);let streak=Number(localStorage.getItem(COIN_STREAK_KEY)||0);const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);streak=last===yesterday?(streak>=30?1:Math.min(30,streak+1)):1;const reward=getSchedule()[streak-1]??0;addCoins(reward);localStorage.setItem(COIN_CHECKIN_KEY,today);localStorage.setItem(COIN_STREAK_KEY,String(streak));alert(`Day ${streak} reward claimed: +${reward} coins`);renderCoinWidgets();return true}
function renderCoinWidgets(){document.querySelectorAll(".coin-balance").forEach(el=>el.textContent=getCoins().toLocaleString()+" Coins");const streak=Number(localStorage.getItem(COIN_STREAK_KEY)||0);const schedule=getSchedule();const last=localStorage.getItem(COIN_CHECKIN_KEY);const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);const nextDay=(last&&last!==yesterday&&last!==new Date().toISOString().slice(0,10))||streak>=30?1:Math.max(1,streak+1);const r=document.getElementById("dailyRate");if(r)r.textContent=`Day ${nextDay}: ${schedule[nextDay-1]} coins`;const v=document.getElementById("coinValue");if(v)v.textContent="৳"+(getCoins()/getConversionRate()).toFixed(2);const status=document.getElementById("checkinStatus");if(status){const today=new Date().toISOString().slice(0,10);status.textContent=localStorage.getItem(COIN_CHECKIN_KEY)===today?`Claimed — Day ${streak}`:`Available — next reward Day ${nextDay}`}}
function loadSupport(){const s=JSON.parse(localStorage.getItem('workPlaceSupportSettings')||'{}');document.querySelectorAll('#supportEmail').forEach(e=>e.textContent=s.email||'support@workplace.example');document.querySelectorAll('#supportPhone').forEach(e=>e.textContent=s.contact||'Admin-controlled support contact')}
document.addEventListener("DOMContentLoaded",()=>{renderCoinWidgets();loadSupport();syncDailyRewardSettings()});
