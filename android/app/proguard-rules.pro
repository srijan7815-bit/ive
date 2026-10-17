# IVE — R8 rules
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-keep class ai.ive.app.** { *; }
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }
-keepattributes *Annotation*, InnerClasses
