import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { TemporalEntity, RSVPStatus } from "../temporal/types";
import { buildICSCalendar, buildICSReply, escapeICSText, parseICSCalendar, type ParsedICSEvent } from "../temporal/ics";

const C = { bg:"#10141D", surface:"#171C28", raised:"#202838", border:"#30394B", text:"#F4F6FC", muted:"#9BA7BA", accent:"#FFC247", wash:"#322817", green:"#72D6A1", danger:"#FF9A63" };
const SUBSCRIPTIONS_KEY = "dr-calender.ics-subscriptions.v1";
type Subscription = { id:string; url:string; name:string; lastChecked:number|null; eventCount:number; error:string|null };
type Props = { events: TemporalEntity[]; onImport:(items: ParsedICSEvent[], strategy:"skip"|"update")=>Promise<void>; onRSVP:(event:TemporalEntity,email:string,status:Exclude<RSVPStatus,"needs-action">)=>Promise<void>; onAddAttendee:(event:TemporalEntity,email:string)=>Promise<void> };
const fmt = (value:number|null) => value === null ? "Unscheduled" : new Date(value).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
const eventUID = (event:TemporalEntity) => event.metadata?.invite?.icsUid ?? event.id + "@dr-calender.local";

export function SharingCenter({events,onImport,onRSVP,onAddAttendee}:Props) {
  const [icsText,setIcsText] = useState("");
  const [preview,setPreview] = useState<ParsedICSEvent[]>([]);
  const [importStrategy,setImportStrategy] = useState<"skip"|"update">("skip");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [subscriptions,setSubscriptions] = useState<Subscription[]>([]);
  const [subscriptionUrl,setSubscriptionUrl] = useState("");
  const [selectedEventId,setSelectedEventId] = useState("");
  const [organizerEmail,setOrganizerEmail] = useState("");
  const [rsvpEmail,setRsvpEmail] = useState("");
  const [newAttendeeEmail,setNewAttendeeEmail] = useState("");
  const [rsvpStatus,setRsvpStatus] = useState<Exclude<RSVPStatus,"needs-action">>("accepted");
  const [showImport,setShowImport] = useState(true);
  const [showSubscriptions,setShowSubscriptions] = useState(true);
  const liveEvents = useMemo(()=>events.filter(e=>e.itemType==="event" && e.deletedAt===null).sort((a,b)=>(a.scheduledAt??0)-(b.scheduledAt??0)),[events]);
  const selectedEvent = liveEvents.find(e=>e.id===selectedEventId) ?? liveEvents[0] ?? null;
  const duplicates = useMemo(()=>preview.filter(item=>events.some(e=>e.itemType==="event" && e.deletedAt===null && e.metadata?.invite?.icsUid===item.uid)).length,[preview,events]);

  useEffect(()=>{ let active=true; SecureStore.getItemAsync(SUBSCRIPTIONS_KEY).then(raw=>{if(active&&raw){try{setSubscriptions(JSON.parse(raw) as Subscription[])}catch{setSubscriptions([])}}}).catch(()=>{}); return ()=>{active=false}; },[]);
  const saveSubscriptions = async (items:Subscription[]) => { setSubscriptions(items); await SecureStore.setItemAsync(SUBSCRIPTIONS_KEY,JSON.stringify(items)); };
  const parseInput = () => {
    setMessage("");
    try { const parsed=parseICSCalendar(icsText.trim()); setPreview(parsed); setMessage("Preview ready. Review duplicates and import strategy before committing."); }
    catch(error){setPreview([]);setMessage(error instanceof Error?error.message:String(error));}
  };
  const importItems = async (items=preview) => {
    if(!items.length)return;
    setBusy(true);setMessage("");
    try { await onImport(items,importStrategy); setMessage("Import completed. Existing UID matches were "+(importStrategy==="skip"?"skipped.":"updated.") ); setPreview([]);setIcsText(""); }
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  };
  const exportCalendar = async (subset:TemporalEntity[]) => {
    try { const payload=buildICSCalendar(subset,"DR-Calender"); await Share.share({title:"DR-Calender calendar export",message:payload}); setMessage("Calendar data prepared for sharing. Choose a compatible destination to save or send the .ics content."); }
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const addSubscription = async () => {
    const url=subscriptionUrl.trim();
    if(!/^https:\/\//i.test(url)){setMessage("Calendar subscription URLs must use HTTPS.");return;}
    let hostname = ""; try { hostname = new URL(url).hostname; } catch { setMessage("Enter a valid HTTPS calendar URL."); return; }
    if(subscriptions.some(s=>s.url===url)){setMessage("This subscription URL is already saved.");return;}
    const item:Subscription={id:"sub-"+Date.now(),url,name:hostname,lastChecked:null,eventCount:0,error:null};
    await saveSubscriptions([...subscriptions,item]);setSubscriptionUrl("");setMessage("Subscription saved. Select Refresh to fetch its current events.");
  };
  const refreshSubscription = async (subscription:Subscription) => {
    setBusy(true);setMessage("");
    try {
      const response=await fetch(subscription.url,{headers:{Accept:"text/calendar, text/plain;q=0.9, */*;q=0.1"}});
      if(!response.ok)throw new Error("Calendar server returned HTTP "+response.status+".");
      const body=await response.text();
      if(body.length>2_000_000)throw new Error("Calendar subscription exceeds the 2 MB import limit.");
      const parsed=parseICSCalendar(body);
      await onImport(parsed,"update");
      await saveSubscriptions(subscriptions.map(s=>s.id===subscription.id?{...s,lastChecked:Date.now(),eventCount:parsed.length,error:null}:s));
      setMessage("Refreshed "+subscription.name+": "+parsed.length+" event records processed.");
    } catch(error) {
      const text=error instanceof Error?error.message:String(error);
      await saveSubscriptions(subscriptions.map(s=>s.id===subscription.id?{...s,lastChecked:Date.now(),error:text}:s));
      setMessage("Subscription refresh failed: "+text);
    } finally{setBusy(false);}
  };
  const removeSubscription = async (id:string) => { await saveSubscriptions(subscriptions.filter(s=>s.id!==id));setMessage("Subscription removed. Previously imported events are kept."); };
  const applyRSVP = async () => {
    if(!selectedEvent){setMessage("Choose an event first.");return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rsvpEmail.trim())){setMessage("Enter a valid attendee email address.");return;}
    setBusy(true);
    try {
      const match=selectedEvent.metadata?.invite?.attendeeList.find(a=>a.email.toLowerCase()===rsvpEmail.trim().toLowerCase());
      if(!match){setMessage("That email is not on this event’s attendee list. Add attendees through an invitation import first.");return;}
      await onRSVP(selectedEvent,rsvpEmail,rsvpStatus);
      setMessage("RSVP updated locally and queued for sync. Use Share RSVP reply to send a METHOD:REPLY payload.");
    } catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  };
  const addAttendee = async () => {
    if (!selectedEvent) { setMessage("Choose an event first."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newAttendeeEmail.trim())) { setMessage("Enter a valid attendee email address."); return; }
    setBusy(true);
    try { await onAddAttendee(selectedEvent,newAttendeeEmail.trim()); setNewAttendeeEmail(""); setMessage("Attendee added. Share the invitation to send the updated attendee list."); }
    catch(error) { setMessage(error instanceof Error?error.message:String(error)); }
    finally { setBusy(false); }
  };
  const shareRSVPReply = async () => {
    if (!selectedEvent) { setMessage("Choose an event first."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rsvpEmail.trim())) { setMessage("Enter a valid attendee email address."); return; }
    try {
      const payload = buildICSReply({ uid:eventUID(selectedEvent), sequence:selectedEvent.metadata?.invite?.sequence??selectedEvent.syncVersion, attendeeEmail:rsvpEmail.trim(), status:rsvpStatus, summary:selectedEvent.title });
      await Share.share({ title:"Calendar RSVP reply", message:payload });
      setMessage("RSVP reply prepared. Send it to the event organizer using the share sheet.");
    } catch(error) { setMessage(error instanceof Error?error.message:String(error)); }
  };
  const shareInvitation = async () => {
    if(!selectedEvent){setMessage("Choose an event first.");return;}
    if(!organizerEmail.trim()){setMessage("Enter the organizer email before creating an invitation.");return;}
    const start=selectedEvent.scheduledAt,end=selectedEvent.endAt;
    if(start===null||end===null){setMessage("Only scheduled events can be shared as invitations.");return;}
    const allDay=selectedEvent.metadata?.event?.kind==="all-day";
    const date=(value:number)=>{const d=new Date(value);return String(d.getFullYear()).padStart(4,"0")+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0")};
    const utc=(value:number)=>new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
    const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//DR-Calender//Temporal Engine//EN","METHOD:REQUEST","CALSCALE:GREGORIAN","BEGIN:VEVENT","UID:"+eventUID(selectedEvent),"SEQUENCE:"+selectedEvent.syncVersion,"DTSTAMP:"+utc(Date.now()),allDay?"DTSTART;VALUE=DATE:"+date(start):"DTSTART:"+utc(start),allDay?"DTEND;VALUE=DATE:"+date(end):"DTEND:"+utc(end),"SUMMARY:"+escapeICSText(selectedEvent.title),...(selectedEvent.metadata?.event?.location?["LOCATION:"+escapeICSText(selectedEvent.metadata.event.location)]:[]),"ORGANIZER:mailto:"+organizerEmail.trim()];
    for(const attendee of selectedEvent.metadata?.invite?.attendeeList??[])lines.push("ATTENDEE;RSVP=TRUE;PARTSTAT="+(attendee.rsvpStatus==="accepted"?"ACCEPTED":attendee.rsvpStatus==="declined"?"DECLINED":attendee.rsvpStatus==="tentative"?"TENTATIVE":"NEEDS-ACTION")+":mailto:"+attendee.email);
    lines.push("END:VEVENT","END:VCALENDAR");
    await Share.share({title:"Event invitation",message:lines.join("\\r\\n")+"\\r\\n"});
  };
  return <ScrollView style={s.root} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.hero}><Text style={s.kicker}>SHARE · IMPORT · EXPORT</Text><Text style={s.heading}>Calendar sharing</Text><Text style={s.subtitle}>Import calendar files, export recurrence-aware ICS, manage subscription URLs, and track attendee responses.</Text></View>
    <View style={s.card}><View style={s.rowHead}><Text style={s.cardTitle}>Import an ICS calendar</Text><Pressable onPress={()=>setShowImport(v=>!v)}><Text style={s.link}>{showImport?"Hide":"Open"}</Text></Pressable></View>{showImport?<><Text style={s.muted}>Paste .ics text below. Up to 1,000 events and 2 MB per import are supported.</Text><TextInput multiline value={icsText} onChangeText={setIcsText} placeholder={"BEGIN:VCALENDAR\\nVERSION:2.0\\n..."} placeholderTextColor={C.muted} style={[s.input,s.multiline]} textAlignVertical="top"/><Pressable disabled={busy||!icsText.trim()} onPress={parseInput} style={s.secondary}><Text style={s.secondaryText}>Preview import</Text></Pressable>{preview.length>0?<><View style={s.preview}><Text style={s.cardTitle}>{preview.length} event(s) found</Text><Text style={s.muted}>{duplicates} existing UID match(es) · {preview.filter(e=>e.recurrenceRule).length} recurring · {preview.filter(e=>e.isAllDay).length} all-day</Text>{preview.slice(0,8).map((item,i)=><View key={item.uid+"-"+i} style={s.previewRow}><Text style={s.eventTitle}>{item.summary}</Text><Text style={s.muted}>{item.start??"No start"}{item.recurrenceRule?" · "+item.recurrenceRule:""}</Text></View>)}</View><View style={s.pills}>{(["skip","update"] as const).map(strategy=><Pressable key={strategy} onPress={()=>setImportStrategy(strategy)} style={[s.pill,importStrategy===strategy&&s.pillActive]}><Text style={[s.pillText,importStrategy===strategy&&s.pillTextActive]}>{strategy==="skip"?"Skip duplicates":"Update matching UID"}</Text></Pressable>)}</View><Pressable disabled={busy} onPress={()=>{void importItems()}} style={s.primary}><Text style={s.primaryText}>{busy?"Importing…":"Import "+preview.length+" event(s)"}</Text></Pressable></>:null}</>:null}</View>
    <View style={s.card}><View style={s.rowHead}><Text style={s.cardTitle}>Export calendar</Text><Text style={s.count}>{liveEvents.length} events</Text></View><Text style={s.muted}>Exports timed and all-day events, recurrence rules, excluded dates, and moved occurrence overrides.</Text><Pressable disabled={busy||liveEvents.length===0} onPress={()=>{void exportCalendar(liveEvents)}} style={s.primary}><Text style={s.primaryText}>Share full calendar (.ics)</Text></Pressable><View style={s.divider}/><Text style={s.label}>SINGLE EVENT</Text>{liveEvents.slice(0,40).map(event=><Pressable key={event.id} onPress={()=>setSelectedEventId(event.id)} style={[s.eventPick,selectedEvent?.id===event.id&&s.eventPickActive]}><View style={{flex:1,gap:3}}><Text style={s.eventTitle}>{event.title}</Text><Text style={s.muted}>{fmt(event.scheduledAt)}</Text></View><Text style={s.check}>{selectedEvent?.id===event.id?"●":"○"}</Text></Pressable>)}{selectedEvent?<Pressable onPress={()=>{void exportCalendar([selectedEvent])}} style={s.secondary}><Text style={s.secondaryText}>Share selected event</Text></Pressable>:null}</View>
    <View style={s.card}><Text style={s.cardTitle}>Invitations & attendee responses</Text><Text style={s.muted}>Invitation sharing uses the system share sheet. RSVP changes apply to attendees already present on the selected event.</Text><Text style={s.label}>ORGANIZER EMAIL</Text><TextInput value={organizerEmail} onChangeText={setOrganizerEmail} autoCapitalize="none" keyboardType="email-address" placeholder="organizer@example.com" placeholderTextColor={C.muted} style={s.input}/><Pressable disabled={!selectedEvent||busy} onPress={()=>{void shareInvitation()}} style={s.secondary}><Text style={s.secondaryText}>Create / share invitation</Text></Pressable><Text style={s.label}>ADD ATTENDEE</Text><TextInput value={newAttendeeEmail} onChangeText={setNewAttendeeEmail} autoCapitalize="none" keyboardType="email-address" placeholder="attendee@example.com" placeholderTextColor={C.muted} style={s.input}/><Pressable disabled={!selectedEvent||busy} onPress={()=>{void addAttendee()}} style={s.secondary}><Text style={s.secondaryText}>Add attendee to selected event</Text></Pressable>{selectedEvent?.metadata?.invite?.attendeeList.map(attendee=><Text key={attendee.email} style={s.muted}>{attendee.displayName??attendee.email} · {attendee.rsvpStatus}</Text>)}<Text style={s.label}>ATTENDEE EMAIL FOR RSVP</Text><TextInput value={rsvpEmail} onChangeText={setRsvpEmail} autoCapitalize="none" keyboardType="email-address" placeholder="attendee@example.com" placeholderTextColor={C.muted} style={s.input}/><View style={s.pills}>{(["accepted","tentative","declined"] as const).map(status=><Pressable key={status} onPress={()=>setRsvpStatus(status)} style={[s.pill,rsvpStatus===status&&s.pillActive]}><Text style={[s.pillText,rsvpStatus===status&&s.pillTextActive]}>{status}</Text></Pressable>)}</View><Pressable disabled={!selectedEvent||busy} onPress={()=>{void applyRSVP()}} style={s.secondary}><Text style={s.secondaryText}>Save RSVP locally</Text></Pressable><Pressable disabled={!selectedEvent||busy} onPress={()=>{void shareRSVPReply()}} style={s.secondary}><Text style={s.secondaryText}>Share RSVP reply (.ics)</Text></Pressable></View>
    <View style={s.card}><View style={s.rowHead}><Text style={s.cardTitle}>Calendar subscriptions</Text><Pressable onPress={()=>setShowSubscriptions(v=>!v)}><Text style={s.link}>{showSubscriptions?"Hide":"Open"}</Text></Pressable></View>{showSubscriptions?<><Text style={s.muted}>Subscribe to a public HTTPS iCalendar feed. Refresh imports by UID; removing a feed does not delete imported events.</Text><TextInput value={subscriptionUrl} onChangeText={setSubscriptionUrl} autoCapitalize="none" keyboardType="url" placeholder="https://example.com/calendar.ics" placeholderTextColor={C.muted} style={s.input}/><Pressable disabled={busy} onPress={()=>{void addSubscription()}} style={s.secondary}><Text style={s.secondaryText}>Save subscription URL</Text></Pressable>{subscriptions.map(sub=><View key={sub.id} style={s.subscription}><View style={{flex:1,gap:4}}><Text style={s.eventTitle}>{sub.name}</Text><Text style={s.muted} numberOfLines={2}>{sub.url}</Text><Text style={sub.error?s.error:s.muted}>{sub.error??(sub.lastChecked?"Last refresh "+new Date(sub.lastChecked).toLocaleString()+" · "+sub.eventCount+" events":"Not refreshed yet")}</Text></View><View style={s.actions}><Pressable disabled={busy} onPress={()=>{void refreshSubscription(sub)}} style={s.mini}><Text style={s.miniText}>Refresh</Text></Pressable><Pressable onPress={()=>{void removeSubscription(sub.id)}} style={s.mini}><Text style={s.miniText}>Remove</Text></Pressable></View></View>)}</>:null}</View>
    {message?<View style={s.message}><Text style={s.messageText}>{message}</Text></View>:null}
    <View style={s.footnote}><Text style={s.footTitle}>Interoperability notes</Text><Text style={s.muted}>Subscriptions require a publicly reachable HTTPS calendar URL; authenticated/private feeds are not supported in this screen. Importing is explicit after preview. Subscription refresh updates matching UID records. Imported event changes are queued for cloud sync when the workspace is connected.</Text></View>
  </ScrollView>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:36,gap:12},hero:{paddingTop:12,paddingBottom:8,gap:6},kicker:{color:C.accent,fontSize:9,fontWeight:"900",letterSpacing:1.6},heading:{color:C.text,fontSize:26,fontWeight:"900"},subtitle:{color:C.muted,fontSize:11,lineHeight:17},card:{padding:14,gap:10,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},rowHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},cardTitle:{color:C.text,fontSize:13,fontWeight:"900"},muted:{color:C.muted,fontSize:10,lineHeight:15},link:{color:C.accent,fontSize:10,fontWeight:"900"},input:{backgroundColor:C.raised,borderWidth:1,borderColor:C.border,borderRadius:10,color:C.text,paddingHorizontal:11,paddingVertical:10,fontSize:11},multiline:{minHeight:120,maxHeight:220},secondary:{borderWidth:1,borderColor:C.border,borderRadius:10,padding:11,alignItems:"center"},secondaryText:{color:C.text,fontSize:10,fontWeight:"800"},primary:{backgroundColor:C.accent,borderRadius:10,padding:12,alignItems:"center"},primaryText:{color:C.bg,fontSize:10,fontWeight:"900"},preview:{backgroundColor:C.raised,borderRadius:10,padding:11,gap:6},previewRow:{paddingVertical:5,borderBottomWidth:1,borderBottomColor:C.border,gap:3},eventTitle:{color:C.text,fontSize:11,fontWeight:"800"},label:{color:C.muted,fontSize:9,fontWeight:"900",letterSpacing:1.2},pills:{flexDirection:"row",gap:7,flexWrap:"wrap"},pill:{paddingHorizontal:10,paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:C.border,backgroundColor:C.raised},pillActive:{borderColor:C.accent,backgroundColor:C.wash},pillText:{color:C.muted,fontSize:9,fontWeight:"800"},pillTextActive:{color:C.accent},count:{color:C.accent,fontSize:10,fontWeight:"900"},divider:{height:1,backgroundColor:C.border,marginVertical:3},eventPick:{flexDirection:"row",alignItems:"center",gap:9,padding:9,borderRadius:9,borderWidth:1,borderColor:"transparent"},eventPickActive:{borderColor:C.accent,backgroundColor:C.wash},check:{color:C.accent},subscription:{flexDirection:"row",gap:8,paddingVertical:10,borderBottomWidth:1,borderBottomColor:C.border},actions:{gap:7,justifyContent:"center"},mini:{borderWidth:1,borderColor:C.border,borderRadius:8,paddingHorizontal:9,paddingVertical:7},miniText:{color:C.text,fontSize:9,fontWeight:"800"},error:{color:C.danger,fontSize:10},message:{padding:11,borderRadius:10,backgroundColor:C.wash,borderWidth:1,borderColor:"#72551C"},messageText:{color:C.text,fontSize:10,lineHeight:16},footnote:{padding:12,gap:5},footTitle:{color:C.text,fontSize:10,fontWeight:"900"}
});
