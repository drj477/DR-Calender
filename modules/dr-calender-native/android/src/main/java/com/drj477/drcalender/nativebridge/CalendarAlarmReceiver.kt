package com.drj477.drcalender.nativebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.Manifest
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

class CalendarAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val title = intent.getStringExtra("alarm.title") ?: "DR Calender alarm"
    val body = intent.getStringExtra("alarm.body") ?: "Your scheduled alarm is due."
    val id = intent.getStringExtra("alarm.id") ?: "default"
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(
        CHANNEL_ID, "Calendar alarms", NotificationManager.IMPORTANCE_HIGH
      ))
    }
    val launch = if (id.startsWith("native-event-")) {
      val payload = id.removePrefix("native-event-")
      val separator = payload.lastIndexOf("-")
      val eventId = if (separator > 0) payload.substring(0, separator) else payload
      val occurrenceStart = if (separator > 0) payload.substring(separator + 1) else null
      val routeId = if (occurrenceStart != null) eventId + "::" + occurrenceStart else eventId
      Intent(Intent.ACTION_VIEW, Uri.parse("drcalender://events/" + Uri.encode(routeId))).apply {
        setPackage(context.packageName)
      }
    } else context.packageManager.getLaunchIntentForPackage(context.packageName)
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
