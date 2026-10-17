package com.drj477.drcalender.widget

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.defaultWeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.unit.dp
import androidx.glance.unit.sp

class CalendarGlanceWidget : GlanceAppWidget() {
  override suspend fun provideGlance(context: Context, id: GlanceId) {
    val prefs = context.getSharedPreferences("drcalender_widget", Context.MODE_PRIVATE)
    val title = prefs.getString("task_title", "Nothing urgent") ?: "Nothing urgent"
    val due = prefs.getString("task_due", "You're all caught up") ?: "You're all caught up"
    val assignee = prefs.getString("task_assignee", "DR") ?: "DR"
    val deepLink = prefs.getString("task_deep_link", "drcalender://tasks") ?: "drcalender://tasks"
    provideContent {
      Column(
        modifier = GlanceModifier.fillMaxSize().background(ColorProvider(Color.rgb(16, 20, 29)))
          .padding(16.dp).clickable(actionStartActivity(Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)))),
        verticalAlignment = Alignment.Vertical.Top,
        horizontalAlignment = Alignment.Horizontal.Start
      ) {
        Text("DR CALENDER · UP NEXT", style = TextStyle(color = ColorProvider(Color.rgb(255, 194, 71)), fontSize = 10.sp))
        Spacer(GlanceModifier.padding(4.dp))
        Text(title, style = TextStyle(color = ColorProvider(Color.WHITE), fontSize = 16.sp))
        Text(due, style = TextStyle(color = ColorProvider(Color.LTGRAY), fontSize = 11.sp))
        Spacer(GlanceModifier.defaultWeight())
        Text("Assigned to " + assignee, style = TextStyle(color = ColorProvider(Color.LTGRAY), fontSize = 10.sp))
      }
    }
  }
}

class CalendarGlanceWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = CalendarGlanceWidget()
}
