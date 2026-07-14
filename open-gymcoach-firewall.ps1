New-NetFirewallRule -DisplayName "GymCoach 3030" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3030 -Profile Private
