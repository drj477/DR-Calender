package com.drj477.drcalender.nativebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class CalendarAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val title = intent.getStringExtra("alarm.title") ?: "DR Calender alarm"
    val body = intent.getStringExtra("alarm.body") ?: "Your scheduled alarm is due."
    val id = intent.getStringExtra("alarm.id") ?: "default"
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL_ID, "Calendar alarms", NotificationManager.IMPORTANCE_HIGH
      ))
    }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(context, id.hashCode(), it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setAutoCancel(true)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()
    manager.notify(id.hashCode(), notification)
  }

  companion object { private const val CHANNEL_ID = "drcalender_native_alarms" }
}
