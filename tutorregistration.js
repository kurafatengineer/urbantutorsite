const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwnhZnXpGVegX3kQtggtRjTej1JrsgfUdDyPrtMmux-IR_I8EGudmGAgLscda2y3nxLg/exec";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
let verifiedEmail = "";

const $ = id => document.getElementById(id);

function setMessage(el, text, type="") { el.textContent=text||""; el.className="message"+(type?" "+type:""); }
function setError(id, text) { const e=$(id); if(e)e.textContent=text||""; }
function clearErrors(){document.querySelectorAll(".field-error").forEach(e=>e.textContent="");}
function val(id){return ($(id)?.value||"").trim();}
function checked(name){const e=document.querySelector(`input[name="${name}"]:checked`);return e?e.value:"";}
function values(containerId){return [...document.querySelectorAll(`#${containerId} input:checked`)].map(x=>x.value);}

async function apiRequest(payload, timeoutMs=45000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(WEB_APP_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),signal:controller.signal});
    const raw=await response.text();
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    let data;
    try{data=JSON.parse(raw);}catch(e){throw new Error("Server returned an invalid response.");}
    return data;
  }catch(err){
    if(err.name==="AbortError") throw new Error("Request timed out. Please try again.");
    if(err instanceof TypeError) throw new Error("Load failed. Please check the API Web App URL and deployment access.");
    throw err;
  }finally{clearTimeout(timer);}
}

function setBusy(button,textId,loaderId,busy){
  button.disabled=busy; $(textId).classList.toggle("hidden",busy); $(loaderId).classList.toggle("hidden",!busy);
}

function validateEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
function validatePhone(id,errorId,label){const v=val(id); if(!/^\d{10}$/.test(v)){setError(errorId,`${label} must contain 10 digits.`);return false}return true;}
function validateFile(id,errorId,imagesOnly=false){const f=$(id).files[0]; if(!f){setError(errorId,"Please upload this file.");return false} if(f.size>MAX_FILE_SIZE){setError(errorId,"File must be 5 MB or smaller.");return false} if(imagesOnly && !/^image\/(jpeg|png)$/.test(f.type)){setError(errorId,"Please upload a JPG or PNG image.");return false} if(!imagesOnly && !["application/pdf","image/jpeg","image/png"].includes(f.type)){setError(errorId,"Please upload PDF, JPG or PNG.");return false}return true;}
function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=()=>reject(new Error("Could not read uploaded file."));r.readAsDataURL(file);});}

$("sameWhatsapp").addEventListener("change",()=>{if($("sameWhatsapp").checked){$("whatsapp").value=val("mobile");$("whatsapp").readOnly=true}else $("whatsapp").readOnly=false;});
$("mobile").addEventListener("input",()=>{if($("sameWhatsapp").checked)$("whatsapp").value=val("mobile");});

$("checkEmailButton").addEventListener("click",async()=>{
  clearErrors(); setMessage($("emailMessage"),"");
  const email=val("email").toLowerCase();
  if(!validateEmail(email)){setError("emailError","Please enter a valid email address.");return;}
  const b=$("checkEmailButton");setBusy(b,"checkEmailText","checkEmailLoader",true);
  try{
    const result=await apiRequest({action:"checkTutorEmail",email});
    if(!result.success) throw new Error(result.message||"Unable to check email.");
    if(result.exists){setMessage($("emailMessage"),result.message||"This email is already registered.","error");return;}
    verifiedEmail=email;$("verifiedEmail").textContent=email;$("registrationFields").classList.remove("hidden");setMessage($("emailMessage"),"Email is available. You can continue.","success");$("registrationFields").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(err){setMessage($("emailMessage"),err.message,"error");}
  finally{setBusy(b,"checkEmailText","checkEmailLoader",false);}
});

$("tutorForm").addEventListener("submit",async e=>{
  e.preventDefault();clearErrors();setMessage($("registrationMessage"),"");
  if(!verifiedEmail){setMessage($("emailMessage"),"Please verify your email first.","error");return;}
  let ok=true;
  ok=validatePhone("mobile","mobileError","Mobile Number")&&ok;ok=validatePhone("whatsapp","whatsappError","WhatsApp Number")&&ok;
  ["firstName","lastName","birthDate","experience","city","address","pinCode"].forEach(id=>{if(!val(id)){setError(id+"Error","This field is required.");ok=false;}});
  if(!/^\d{6}$/.test(val("pinCode"))){setError("pinError","Pin Code must contain 6 digits.");ok=false;}
  if(values("languages").length===0){setError("languagesError","Select at least one language.");ok=false;}
  if(values("classesTeach").length===0){setError("classesError","Select at least one class range.");ok=false;}
  if(values("subjectsTeach").length===0){setError("subjectsError","Select at least one subject.");ok=false;}
  if(values("boardsTeach").length===0){setError("boardsError","Select at least one board.");ok=false;}
  ok=validateFile("identityProof","identityError",false)&&ok;ok=validateFile("profileImage","profileError",true)&&ok;
  if(!$("terms").checked){setError("termsError","Please accept the Terms & Conditions.");ok=false;}
  if(!ok){const first=document.querySelector(".field-error:not(:empty)");if(first)first.scrollIntoView({behavior:"smooth",block:"center"});return;}

  const button=$("registerButton");setBusy(button,"registerText","registerLoader",true);
  try{
    const identity=$("identityProof").files[0], profile=$("profileImage").files[0];
    const [identityData,profileData]=await Promise.all([fileToBase64(identity),fileToBase64(profile)]);
    const payload={action:"tutorregistration",email:verifiedEmail,mobile:val("mobile"),whatsapp:val("whatsapp"),registerAs:checked("registerAs"),firstName:val("firstName"),lastName:val("lastName"),birthDate:val("birthDate"),gender:checked("gender"),languages:values("languages"),identityProof:{name:identity.name,mimeType:identity.type,size:identity.size,data:identityData},profileImage:{name:profile.name,mimeType:profile.type,size:profile.size,data:profileData},twelfthStream:checked("twelfthStream"),twelfthYear:val("twelfthYear"),twelfthGrade:val("twelfthGrade"),twelfthBoard:checked("twelfthBoard"),graduationCourse:val("graduationCourse"),graduationSubject:val("graduationSubject"),graduationCollege:val("graduationCollege"),graduationYear:val("graduationYear"),graduationPercentage:val("graduationPercentage"),pgSubject:val("pgSubject"),pgCollege:val("pgCollege"),pgYear:val("pgYear"),pgPercentage:val("pgPercentage"),specialCourses:values("specialCourses"),disability:values("disability"),experience:val("experience"),classesTeach:values("classesTeach"),subjectsTeach:values("subjectsTeach"),boardsTeach:values("boardsTeach"),location:val("location"),city:val("city"),address:val("address"),pinCode:val("pinCode")};
    const result=await apiRequest(payload,90000);
    if(!result.success) throw new Error(result.message||"Registration could not be completed.");
    $("successText").textContent=`Your Tutor ID is ${result.tutorId||"generated successfully"}. Your documents have been saved for verification.`;$("successPage").classList.remove("hidden");window.scrollTo(0,0);
  }catch(err){setMessage($("registrationMessage"),err.message,"error");}
  finally{setBusy(button,"registerText","registerLoader",false);}
});

$("termsButton").onclick=()=>$("termsModal").classList.remove("hidden");$("closeTerms").onclick=()=>$("termsModal").classList.add("hidden");$("acceptTerms").onclick=()=>{ $("terms").checked=true;$("termsModal").classList.add("hidden");setError("termsError","");};$("termsModal").querySelector(".modal-overlay").onclick=()=>$("termsModal").classList.add("hidden");
