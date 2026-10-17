package com.drj477.drcalender.nativebridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Re-registers persisted native alarms after reboot or wall-clock/time-zone changes. */
class AlarmRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
        intent.action != Intent.ACTION_TIME_CHANGED &&
        intent.action != Intent.ACTION_TIMEZONE_CHANGED &&
        intent.action != AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED) return
    val prefs = context.getSharedPreferences("drcalender_native_alarms", Context.MODE_PRIVATE)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) return
    val ids = prefs.getStringSet("alarm_ids", emptySet())?.toList().orEmpty()
    val now = System.currentTimeMillis()
    ids.forEach { id ->
      val triggerAt = prefs.getLong("alarm.$id.trigger", 0L)
      if (triggerAt <= now) return@forEach
      val title = prefs.getString("alarm.$id.title", "DR Calender alarm") ?: "DR Calender alarm"
      val body = prefs.getString("alarm.$id.body", "Your scheduled alarm is due.") ?: "Your scheduled alarm is due."
      val alarmIntent = Intent(context, CalendarAlarmReceiver::class.java).apply {
        action = "com.drj477.drcalender.ALARM.$id"
        putExtra("alarm.id", id)
        putExtra("alarm.title", title)
        putExtra("alarm.body", body)
      }
      val pending = PendingIntent.getBroadcast(context, id.hashCode(), alarmIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val show = launchIntent?.let { PendingIntent.getActivity(context, id.hashCode(), it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
      if (show != null) manager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, show), pending)
      else manager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pending)
    }
  }
}
