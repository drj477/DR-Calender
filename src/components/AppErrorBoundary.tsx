import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props={children:React.ReactNode};
type State={hasError:boolean;message:string};

export class AppErrorBoundary extends React.Component<Props,State>{
 state:State={hasError:false,message:""};
 static getDerivedStateFromError(error:unknown):State{
  return {hasError:true,message:error instanceof Error?error.message:"An unexpected rendering error occurred."};
 }
 componentDidCatch(error:Error,info:React.ErrorInfo){
  // Keep diagnostics local; do not send calendar content or stack traces to a remote service.
  console.warn("DR Calender UI error boundary caught an error",error.message,info.componentStack);
 }
 render(){
  if(!this.state.hasError)return this.props.children;
  return <View style={s.root}>
   <Text style={s.kicker}>RECOVERY MODE</Text>
   <Text style={s.heading}>This screen hit a problem</Text>
   <Text style={s.body}>Your locally saved calendar data has not been intentionally changed by this recovery screen. Reopen the app if the problem persists, and export a backup from Data Safety before attempting recovery.</Text>
   <View style={s.detail}><Text style={s.detailLabel}>Local error detail</Text><Text selectable style={s.detailText}>{this.state.message}</Text></View>
   <Pressable accessibilityRole="button" onPress={()=>this.setState({hasError:false,message:""})} style={s.button}><Text style={s.buttonText}>Try this screen again</Text></Pressable>
  </View>;
 }
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:"#10141D",justifyContent:"center",padding:24,gap:14},kicker:{color:"#FFC247",fontSize:10,fontWeight:"900",letterSpacing:1.5},heading:{color:"#F4F6FC",fontSize:25,fontWeight:"900"},body:{color:"#9BA7BA",fontSize:12,lineHeight:19},detail:{padding:12,backgroundColor:"#171C28",borderWidth:1,borderColor:"#30394B",borderRadius:12,gap:6},detailLabel:{color:"#FFC247",fontSize:10,fontWeight:"900"},detailText:{color:"#F4F6FC",fontSize:11,lineHeight:16},button:{padding:13,backgroundColor:"#FFC247",borderRadius:10,alignItems:"center"},buttonText:{color:"#10141D",fontSize:11,fontWeight:"900"}});
