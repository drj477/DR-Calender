package com.drj477.drcalender.nativebridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.glance.appwidget.GlanceAppWidgetManager
import com.drj477.drcalender.widget.CalendarGlanceWidget
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Calendar

class DRCalenderNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DRCalenderNative")

    AsyncFunction("isExactAlarmAllowed") {
      val context = requireNotNull(appContext.reactContext)
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
    }

    AsyncFunction("requestExactAlarmPermission") {
      val context = requireNotNull(appContext.reactContext)
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (!manager.canScheduleExactAlarms()) {
          val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
            Uri.parse("package:${context.packageName}"))
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(intent)
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) manager.canScheduleExactAlarms() else true
    }

    AsyncFunction("scheduleExactAlarm") { id: String, title: String, body: String, triggerAtMillis: Double ->
      val context = requireNotNull(appContext.reactContext)
      val trigger = triggerAtMillis.toLong()
      require(trigger > System.currentTimeMillis()) { "Alarm must be scheduled in the future." }
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
        throw SecurityException("Exact alarm permission has not been granted.")
      }
      val requestCode = id.hashCode()
      val intent = Intent(context, CalendarAlarmReceiver::class.java).apply {
        action = "com.drj477.drcalender.ALARM.$id"
        putExtra("alarm.id", id)
        putExtra("alarm.title", title)
        putExtra("alarm.body", body)
      }
      val pending = PendingIntent.getBroadcast(context, requestCode, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: throw IllegalStateException("Unable to create app launch intent for alarm UI.")
      val show = PendingIntent.getActivity(context, requestCode, launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      manager.setAlarmClock(AlarmManager.AlarmClockInfo(trigger, show), pending)
      val prefs = context.getSharedPreferences("drcalender_native_alarms", Context.MODE_PRIVATE)
      val ids = (prefs.getStringSet("alarm_ids", emptySet()) ?: emptySet()).toMutableSet()
      ids.add(id)
      prefs.edit().putStringSet("alarm_ids", ids)
        .putLong("alarm.$id.trigger", trigger).putString("alarm.$id.title", title)
        .putString("alarm.$id.body", body).apply()
      true
    }

    AsyncFunction("cancelExactAlarm") { id: String ->
      val context = requireNotNull(appContext.reactContext)
      val intent = Intent(context, CalendarAlarmReceiver::class.java).apply {
        action = "com.drj477.drcalender.ALARM.$id"
      }
      val pending = PendingIntent.getBroadcast(context, id.hashCode(), intent,
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (pending != null) {
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
        pending.cancel()
      }
      val prefs = context.getSharedPreferences("drcalender_native_alarms", Context.MODE_PRIVATE)
      val ids = (prefs.getStringSet("alarm_ids", emptySet()) ?: emptySet()).toMutableSet()
      ids.remove(id)
      prefs.edit().putStringSet("alarm_ids", ids).remove("alarm.$id.trigger")
        .remove("alarm.$id.title").remove("alarm.$id.body").apply()
      true
    }

    AsyncFunction("publishWidgetSnapshot") { title: String, dueLabel: String, assignee: String, deepLink: String ->
      val context = requireNotNull(appContext.reactContext)
      context.getSharedPreferences("drcalender_widget", Context.MODE_PRIVATE).edit()
        .putString("task_title", title)
        .putString("task_due", dueLabel)
        .putString("task_assignee", assignee)
        .putString("task_deep_link", deepLink)
        .apply()
      GlanceAppWidgetManager(context).getGlanceIds(CalendarGlanceWidget::class.java).forEach { id ->
        CalendarGlanceWidget().update(context, id)
      }
      true
    }
  }
}
