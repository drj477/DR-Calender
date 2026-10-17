import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import type { TemporalEntity } from "../temporal/types";
import { cancelNativeAlarm, isExactAlarmAllowed, isNativeAlarmScheduled, isNativeBridgeAvailable, requestExactAlarmPermission, scheduleNativeAlarm } from "../native/nativeExperience";

const C={bg:"#10141D",surface:"#171C28",raised:"#202838",border:"#30394B",text:"#F4F6FC",muted:"#9BA7BA",accent:"#FFC247",wash:"#322817",green:"#72D6A1",danger:"#FF9A63"};
type Props={entities:TemporalEntity[]};

export function NativeExperienceCenter({entities}:Props){
  const [bridgeAvailable,setBridgeAvailable]=useState(false);
  const [exactAllowed,setExactAllowed]=useState(false);
  const [notificationAllowed,setNotificationAllowed]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [scheduled,setScheduled]=useState<Record<string,boolean>>({});
  const [message,setMessage]=useState("");
  const platformCanSchedule = bridgeAvailable && notificationAllowed && (Platform.OS === "ios" || exactAllowed);
  const upcoming=useMemo(()=>entities.filter(e=>e.itemType==="event"&&e.deletedAt===null&&!e.isCompleted&&e.scheduledAt!==null&&e.scheduledAt>Date.now()).sort((a,b)=>(a.scheduledAt??0)-(b.scheduledAt??0)).slice(0,12),[entities]);
  useEffect(()=>{let active=true;setBridgeAvailable(isNativeBridgeAvailable());void isExactAlarmAllowed().then(value=>{if(active)setExactAllowed(value)}).catch(()=>{if(active)setExactAllowed(false)});void Notifications.getPermissionsAsync().then(value=>{if(active)setNotificationAllowed(value.granted)}).catch(()=>{if(active)setNotificationAllowed(false)});return()=>{active=false}},[]);
  useEffect(()=> {
    let active = true;
    Promise.all(upcoming.map(async event => [event.id, await isNativeAlarmScheduled("native-event-manual-" + event.id)] as const))
      .then(entries => { if (active) setScheduled(Object.fromEntries(entries)); })
      .catch(error => console.warn("Unable to load scheduled native alarms", error));
    return () => { active = false; };
  }, [upcoming]);
  const requestPermission=async()=>{
    setMessage("");setBusyId("permission");
    try{
      const currentNotifications=await Notifications.getPermissionsAsync();
      const notificationsGranted=currentNotifications.granted || (await Notifications.requestPermissionsAsync()).granted;
      const result=await requestExactAlarmPermission();
      setNotificationAllowed(notificationsGranted);
      setMessage(result&&notificationsGranted?"Native alarm and notification permissions are available.": "Return from system Settings and reopen this screen to refresh permission status.");
    }
    catch(error){setMessage(error instanceof Error?error.message:String(error))}
    finally{
      setBusyId(null);
      void isExactAlarmAllowed().then(setExactAllowed).catch(()=>setExactAllowed(false));
      void Notifications.getPermissionsAsync().then(value=>setNotificationAllowed(value.granted)).catch(()=>setNotificationAllowed(false));
    }
  };
  const schedule=async(event:TemporalEntity)=>{
    if(event.metadata?.event?.reminderMinutesBefore!=null) {
      setMessage("This event already has an automatic reminder. Edit its reminder offset instead of creating a second alarm.");
      return;
    }
    const id="native-event-manual-"+event.id;
    setBusyId("event-"+event.id);setMessage("");
    try{
      const lead=event.metadata?.event?.reminderMinutesBefore??0;
      const triggerAt=(event.scheduledAt??0)-lead*60_000;
      if(triggerAt<=Date.now())throw new Error("The event reminder time is in the past. Choose a future event or adjust its reminder offset.");
      const ok=await scheduleNativeAlarm({id,title:event.title,body:lead>0?"Your event starts in "+lead+" minute(s).":"Your event starts now.",triggerAt});
      if(!ok)throw new Error("Native alarm module is unavailable. Use a development build with the native module installed.");
      setScheduled(current=>({...current,[event.id]:true}));setMessage("Native alarm scheduled for "+new Date(triggerAt).toLocaleString()+".");
    }catch(error){setMessage(error instanceof Error?error.message:String(error))}
    finally{setBusyId(null)}
  };
  const cancel=async(event:TemporalEntity)=>{
    const id="native-event-manual-"+event.id;setBusyId("event-"+event.id);
    try{await cancelNativeAlarm(id);setScheduled(current=>({...current,[event.id]:false}));setMessage("Native alarm cancelled.")}
    catch(error){setMessage(error instanceof Error?error.message:String(error))}
    finally{setBusyId(null)}
  };
  return <ScrollView style={s.root} contentContainerStyle={s.content}>
    <View style={s.hero}><Text style={s.kicker}>NATIVE EXPERIENCE</Text><Text style={s.heading}>Widgets & alarms</Text><Text style={s.subtitle}>Publish the next task to the Android home-screen widget and manage native alarm-clock scheduling where supported.</Text></View>
    <View style={s.card}><View style={s.row}><Text style={s.title}>Native bridge</Text><Text style={[s.badge,{color:bridgeAvailable?C.green:C.danger}]}>{bridgeAvailable?"AVAILABLE":"NOT INSTALLED"}</Text></View><Text style={s.muted}>{bridgeAvailable?"The installed native build exposes alarm and widget APIs.":"This feature requires a rebuilt development/production app. It is not available in Expo Go."}</Text><View style={s.row}><Text style={s.title}>Exact alarm access</Text><Text style={[s.badge,{color:Platform.OS==="ios"?C.muted:exactAllowed?C.green:C.accent}]}>{Platform.OS==="ios"?"NOT REQUIRED":exactAllowed?"GRANTED":"NOT CONFIRMED"}</Text></View><View style={s.row}><Text style={s.title}>Notification permission</Text><Text style={[s.badge,{color:notificationAllowed?C.green:C.accent}]}>{notificationAllowed?"GRANTED":"NOT GRANTED"}</Text></View><Text style={s.muted}>Android exact alarm permission is user-controlled and may open system Settings. Alarm delivery also requires notification permission. On iOS, the native bridge schedules standard local notifications and does not require Android-style exact-alarm access.</Text><Pressable disabled={!bridgeAvailable||busyId!==null} onPress={()=>{void requestPermission()}} style={[s.button,(!bridgeAvailable||busyId!==null)&&s.disabled]}><Text style={s.buttonText}>{busyId==="permission"?"Opening…":"Request / check native alarm permission"}</Text></Pressable></View>
    <View style={s.card}><Text style={s.title}>Upcoming events</Text><Text style={s.muted}>Schedule or cancel a native alarm for an event. Existing Expo notifications remain separate and are not automatically duplicated by this screen.</Text>{upcoming.length?upcoming.map(event=><View key={event.id} style={s.event}><View style={{flex:1,gap:4}}><Text style={s.eventTitle}>{event.title}</Text><Text style={s.muted}>{new Date(event.scheduledAt??0).toLocaleString()}</Text></View><Pressable disabled={!platformCanSchedule||busyId!==null||event.metadata?.event?.reminderMinutesBefore!=null} onPress={()=>{void schedule(event)}} style={[s.mini,(!platformCanSchedule||busyId!==null||event.metadata?.event?.reminderMinutesBefore!=null)&&s.disabled]}><Text style={s.miniText}>{busyId==="event-"+event.id?"…":event.metadata?.event?.reminderMinutesBefore!=null?"Automatic":"Schedule"}</Text></Pressable>{scheduled[event.id]?<Pressable disabled={busyId!==null} onPress={()=>{void cancel(event)}} style={s.mini}><Text style={s.miniText}>Cancel</Text></Pressable>:null}</View>):<Text style={s.muted}>No upcoming scheduled events in the active workspace.</Text>}</View>
    {message?<View style={s.message}><Text style={s.messageText}>{message}</Text></View>:null}
    <View style={s.foot}><Text style={s.title}>Platform limits</Text><Text style={s.muted}>Android uses AlarmManager.setAlarmClock and a native broadcast receiver. Delivery still depends on OS policy and notification permission. iOS schedules standard notifications; critical-alert privileges and a WidgetKit extension target require separate Apple-side setup.</Text></View>
  </ScrollView>
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:C.bg},content:{padding:18,paddingBottom:36,gap:12},hero:{paddingTop:12,paddingBottom:8,gap:6},kicker:{color:C.accent,fontSize:9,fontWeight:"900",letterSpacing:1.6},heading:{color:C.text,fontSize:26,fontWeight:"900"},subtitle:{color:C.muted,fontSize:11,lineHeight:17},card:{padding:14,gap:11,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:15},row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},title:{color:C.text,fontSize:13,fontWeight:"900"},badge:{fontSize:9,fontWeight:"900",letterSpacing:1},muted:{color:C.muted,fontSize:10,lineHeight:15},button:{backgroundColor:C.accent,borderRadius:10,padding:12,alignItems:"center"},buttonText:{color:C.bg,fontSize:10,fontWeight:"900"},disabled:{opacity:.4},event:{flexDirection:"row",alignItems:"center",gap:7,paddingVertical:9,borderBottomWidth:1,borderBottomColor:C.border},eventTitle:{color:C.text,fontSize:11,fontWeight:"800"},mini:{borderWidth:1,borderColor:C.border,borderRadius:8,paddingHorizontal:9,paddingVertical:8},miniText:{color:C.text,fontSize:9,fontWeight:"800"},message:{padding:11,borderRadius:10,backgroundColor:C.wash,borderWidth:1,borderColor:"#72551C"},messageText:{color:C.text,fontSize:10,lineHeight:16},foot:{padding:12,gap:6}});
