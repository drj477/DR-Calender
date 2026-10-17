package com.drj477.drcalender.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.unit.dp
import androidx.glance.unit.sp
import android.graphics.Color
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.actionStartActivity

class CalendarGlanceWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            CalendarWidgetContent(context)
        }
    }
}

@Composable
private fun CalendarWidgetContent(context: Context) {
    val prefs = context.getSharedPreferences("drcalender_widget", Context.MODE_PRIVATE)
    val title = prefs.getString("task_title", "Nothing urgent") ?: "Nothing urgent"
    val due = prefs.getString("task_due", "You're all caught up") ?: "You're all caught up"
    val assignee = prefs.getString("task_assignee", "DR") ?: "DR"

    Column(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ColorProvider(Color.rgb(20, 25, 34)))
            .padding(16.dp),
        verticalAlignment = Alignment.Vertical.Top,
        horizontalAlignment = Alignment.Horizontal.Start
    ) {
        Text(
            text = "UP NEXT",
            style = TextStyle(color = ColorProvider(Color.rgb(184, 243, 107)), fontSize = 10.sp)
        )
        Spacer(modifier = GlanceModifier.padding(4.dp))
        Text(
            text = title,
            style = TextStyle(color = ColorProvider(Color.WHITE), fontSize = 15.sp)
        )
        Text(
            text = due,
            style = TextStyle(color = ColorProvider(Color.LTGRAY), fontSize = 11.sp)
        )
        Spacer(modifier = GlanceModifier.defaultWeight())
        Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
            Text(
                text = assignee,
                style = TextStyle(color = ColorProvider(Color.BLACK), fontSize = 11.sp)
            )
            Spacer(modifier = GlanceModifier.width(6.dp))
            Text(
                text = "Assigned to " + assignee,
                style = TextStyle(color = ColorProvider(Color.LTGRAY), fontSize = 10.sp)
            )
        }
    }
}

class CalendarGlanceWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CalendarGlanceWidget()
}
