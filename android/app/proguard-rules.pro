# Keep serializable model metadata used by the offline bootstrap and outbox contracts.
-keepattributes *Annotation*, InnerClasses, EnclosingMethod
-keep,includedescriptorclasses class org.sharteman.gymcoach.data.model.**$$serializer { *; }
-keep,includedescriptorclasses class org.sharteman.gymcoach.data.offline.**$$serializer { *; }
-keep,includedescriptorclasses class org.sharteman.gymcoach.watch.domain.**$$serializer { *; }

# Huawei Wear Engine discovers transport classes through SDK metadata.
-keep class com.huawei.wearengine.** { *; }
-dontwarn com.huawei.wearengine.**
